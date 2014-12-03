var http = require('http');

module.exports = function(app, options) {
    var httpServer = http.createServer(app);

    return {
        start: function(callback) {
            httpServer.listen(options.port, function(err) {
                callback(err, httpServer);
            });
        },
        stop: function(callback) {
            httpServer.close(callback);
        }
    };
};
