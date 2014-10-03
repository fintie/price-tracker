/**
 */
function Request() {}

Request.prototype.toString = function() {
    return JSON.stringify({
        type: this.constructor.name,
        request: this
    });
};

Request.fromString = function(string) {
    var object = JSON.parse(string);

    var request = new module.exports[object.type]();

    for(var prop in object.request) {
        request[prop] = object.request[prop];
    }

    return request;
};

/**
 */
function PriceRequest(exchange, symbol, options) {
    this.exchange = exchange;
    this.symbol = symbol;
    this.options = options;
}

PriceRequest.prototype = Object.create(Request.prototype);
PriceRequest.prototype.constructor = PriceRequest;

PriceRequest.prototype.hash = function() {
    return this.exchange + this.symbol + JSON.stringify(this.options);
};

/**
 */
function SubscribeRequest(exchange, symbol, options) {
    this.exchange = exchange;
    this.symbol = symbol;
    this.options = options;
}

SubscribeRequest.prototype = Object.create(Request.prototype);
SubscribeRequest.prototype.constructor = SubscribeRequest;

/**
 */
function ExchangesRequest(options) {
    this.options = options;
}

ExchangesRequest.prototype = Object.create(Request.prototype);
ExchangesRequest.prototype.constructor = ExchangesRequest;

/**
 */
function Response() {}

Response.prototype.toString = function() {
    return JSON.stringify({
        type: this.constructor.name,
        response: this
    });
};

Response.fromString = function (string) {
    if (string === null)
        return null;

    var object = JSON.parse(string);

    response = new module.exports[object.type]();

    for(var prop in object.response) {
        response[prop] = object.response[prop];
    }

    return response;
};

function Error(message, info) {
    this.message = message;
    this.info = info;
}

Error.prototype = Object.create(Response.prototype);
Error.prototype.constructor = Error;

function Price(exchange, symbol, bid, ask, updated_on, custom) {
    this.exchange = exchange;
    this.symbol = symbol;
    this.bid = bid;
    this.ask = ask;
    this.updated_on = updated_on || new Date();
    this.custom = custom || {};
}

Price.prototype = Object.create(Response.prototype);
Price.prototype.constructor = Price;

function Exchanges() {}

Exchanges.prototype = Object.create(Response.prototype);
Exchanges.prototype.constructor = Exchanges;

Exchanges.prototype.addExchange = function (exchange, symbols) {
    this[exchange] = symbols;
};

/**
 */
try {
    module.exports.Request = Request;
    module.exports.PriceRequest = PriceRequest;
    module.exports.ExchangesRequest = ExchangesRequest;
    module.exports.SubscribeRequest = SubscribeRequest;

    module.exports.Response = Response;
    module.exports.Error = Error;
    module.exports.Price = Price;
    module.exports.Exchanges = Exchanges;
} catch(e) {
    console.log("Running outside node: " + e);
}

