var request = require('request');
var zlib = require('zlib');

/**
 */
function PriceRequester(symbol, options) {
    this.symbol = symbol;
    this.options = options;
}

PriceRequester.prototype.__doRequest = function (url, callback, errback) {
    var _this = this;

    var req_obj = {
        url: url,
        encoding: null
    };

    request(req_obj,
        function (error, response, body) {
            try {
                if (error !== null) {
                    throw ("Error: " + error);
                }
                if (response.statusCode != 200) {
                    throw ("Error, status code: " + response.statusCode);
                }
                if (response.headers['content-encoding'] == 'gzip'){
                    zlib.gunzip(body, function(err, dezipped) {
                        callback(_this.processResponse(response, dezipped.toString()));
                    });
                } else {
                    callback(_this.processResponse(response, body.toString()));
                }
            } catch(e) {
                errback(e, {
                    exchange: _this.getExchange(),
                    symbol: _this.symbol,
                });
            }
        }
    );
};

PriceRequester.prototype.doRequest = function (callback, errback) {
    this.__doRequest(this.buildRequest(), callback, errback);
};

PriceRequester.prototype.getExchange = function() {
    var _config = this.constructor.config;
    return _config.exchange;
};

PriceRequester.prototype.buildRequest = function() {
    var _config = this.constructor.config;

    if (this.symbol && !(this.symbol in _config.symbol_map)) {
        throw ("Invalid symbol: " + this.symbol);
    }

    return _config.url_template.replace("<<SYMBOL>>", 
                                        _config.symbol_map[this.symbol]);
};

PriceRequester.prototype.processResponse = function(response, body) {
    throw ("processResponse should be overriden!");
};

module.exports = PriceRequester;