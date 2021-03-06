var redis = require('redis'),
    url = require('url'),
    config = require('../../config/config'),
    messages = require('../../public/lib/messages.js'),
    helpers = require('../../public/lib/helpers.js');

var Broadcaster = require('../models/Broadcaster.js');

function to_day_key(date) {
    var zp2 = function (n) { return ('0'+n).slice(-2); };

    return "".concat(date.getUTCFullYear(), ".",
                     zp2(date.getUTCMonth()+1), ".",
                     zp2(date.getUTCDate()));
}

function from_day_key(key) {
    var tokens = key.split(".");
    var date = new Date(0);

    date.setUTCFullYear(parseInt(tokens[0]));
    date.setUTCMonth(parseInt(tokens[1])-1);
    date.setUTCDate(parseInt(tokens[2]));

    return date;
}

/**
 */
function PriceStore() {
    var redisURL = url.parse(config.redis.url),
        client = redis.createClient(redisURL.port,
                                    redisURL.hostname,
                                    {no_ready_check: true});

    if (redisURL.auth)
        client.auth(redisURL.auth.split(':')[1]);

    console.log("PriceStore: connected to", redisURL.hostname);

    this.client = client;
    this.key_prefix = config.redis.key_prefix;

    this.broadcaster = Broadcaster.getInstance();
}

PriceStore.instance = null;

PriceStore.getInstance = function () {
    if (!PriceStore.instance) {
        PriceStore.instance = new PriceStore();
    }

    return PriceStore.instance;
};

PriceStore.deleteInstance = function () {
    if (PriceStore.instance) {
        PriceStore.instance = null;
    }
};

PriceStore.prototype.lastKey = function(exchange, symbol) {
    return this.key_prefix.concat(symbol, ":", exchange, ":", "last");
};

PriceStore.prototype.seriesKey = function(exchange, symbol, freq, date) {
    return this.key_prefix.concat(symbol, ":", exchange, ":", freq, ":", date);
};

PriceStore.prototype.accumulate = function(last, current, date_func) {
    if (last === null) {
        return {
            date: date_func(current.updated_on),
            bid: {open: current.bid,
                  high: current.bid,
                  low: current.bid,
                  close: current.bid},
            ask: {open: current.ask,
                  high: current.ask,
                  low: current.ask,
                  close: current.ask},
        };
    } else if (last.date !== date_func(current.updated_on)) {
        return {
            date: date_func(current.updated_on),
            bid: {open: last.bid.close,
                  high: Math.max(last.bid.close, current.bid),
                  low: Math.min(last.bid.close, current.bid),
                  close: current.bid},
            ask: {open: last.ask.close,
                  high: Math.max(last.ask.close, current.ask),
                  low: Math.min(last.ask.close, current.ask),
                  close: current.ask},
        };
    } else {
        return {
            date: date_func(current.updated_on),
            bid: {open: last.bid.open,
                  high: Math.max(last.bid.high, current.bid),
                  low: Math.min(last.bid.low, current.bid),
                  close: current.bid},
            ask: {open: last.ask.open,
                  high: Math.max(last.ask.high, current.ask),
                  low: Math.min(last.ask.low, current.ask),
                  close: current.ask},
        };
    }
};

PriceStore.prototype.merge = function(last, current) {
    if (last === null)
        return current;

    return helpers.merge(last, current);
};

PriceStore.prototype.registerLastChange = function(last, value, date_func) {
    var key = this.lastKey(value.spot.exchange, value.spot.symbol);
    if (last === null) {
        console.log("No previous value for", key);
        return true;
    }

    if ((value.spot.bid && last.spot.bid && value.spot.bid !== last.spot.bid) ||
        (value.spot.ask && last.spot.ask && value.spot.ask !== last.spot.ask) ||
        (value.spot.updated_on && last.spot.updated_on && 
         date_func(value.spot.updated_on) !=
         date_func(new Date(last.spot.updated_on)))) {

        var timedelta = (
            value.spot.updated_on.getTime() -
            Date.parse(last.spot.stats.last_change)
        );

        if (timedelta < config.streaming.resolution) {
            console.log("Last change for", key, "received:", timedelta, "ms ago");
            return false;
        }

        value.spot = helpers.merge(
            value.spot, {
                stats : {
                    last_change: value.spot.updated_on
                }
            }
        );

        return true;
    }

    console.log("Price didn't change for", key);
    return false;
};

PriceStore.prototype.toSymbol = function(value) {
    var message = new messages.Symbol();
    message.data = helpers.merge(
        value.spot, {
            stats: {
                daily: {
                    date: from_day_key(value.daily.date),
                    bid: value.daily.bid,
                    ask: value.daily.ask
                }
            }
        }
    );
    return message;
};

PriceStore.prototype.listener = function(error, response) {
    var self = this;

    if (error !== null) {
        console.log("PriceStore: WARNING ignoring error:", error);
        return;
    }

    if (response.data.bid === 0 || response.data.ask === 0 ||
        response.data.bid === null || response.data.ask === null ||
        isNaN(response.data.bid) || isNaN(response.data.ask)) {
        console.log("PriceStore: WARNING ignoring invalid value:", response.data);
        return;
    }

    var last_key = self.lastKey(response.data.exchange, response.data.symbol),
        daily_key = self.seriesKey(
                        response.data.exchange,
                        response.data.symbol,
                        "daily",
                        to_day_key(response.data.updated_on)
                     );

    self.client.get(last_key, function (error, last_val) {
        if (error) {
            console.log("PriceStore: ERROR getting", last_key, error);
            return;
        }

        var last = last_val ? JSON.parse(last_val) : null;

        var value = {
            spot: self.merge(last ? last.spot : null, response.data),
            daily: self.accumulate(last ? last.daily : null, response.data, to_day_key),
        };

        if (!self.registerLastChange(last, value, to_day_key)) {
            console.log("PriceStore: skipping update");
            return;
        }

        // Forward to the broadcaster:
        var message = self.toSymbol(value);
        self.broadcaster.listener(null, message);

        self.client.mset(last_key, JSON.stringify(value),
                         daily_key, JSON.stringify(value.daily),
            function (error, ret) {
                if (error) {
                    console.log("PriceStore: ERROR saving", last_key, ":", error);
                } else {
                    console.log("PriceStore: saved", last_key, daily_key, ":", ret);
                }
            }
        );
    });
};

PriceStore.prototype.getPrices = function(exchange, symbol, start, end, callback) {
    var self = this;

    var query = this.seriesKey(exchange, symbol, 'daily', '*');

    this.client.keys(query, function (error, keys) {
        if (error)
            return callback(error);

        if(keys.length === 0)
            return callback(null, []);

        keys.sort();

        self.client.mget(keys, function (error, values) {
            if (error)
                return callback(error);

            callback(null, values.map(function (value) {
                value = JSON.parse(value);
                return {
                    date: from_day_key(value.date),
                    bid: value.bid,
                    ask: value.ask
                };
            }));
        });
    });
};

PriceStore.prototype.getLastPrice = function(exchange, symbol, callback) {
    var self = this;

    this.client.get(this.lastKey(exchange, symbol), function (error, value) {
        if (error) {
            callback(error);
            return;
        }
        if (value === null) {
            callback({
                exception: "NOT FOUND",
                info: {
                    exchange: exchange,
                    symbol: symbol
                }
            });
            return;
        }
        callback(null, self.toSymbol(JSON.parse(value)));
    });
};

module.exports = PriceStore;