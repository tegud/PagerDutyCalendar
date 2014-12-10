var express = require('express');
var fs = require('fs');
var hbs = require('hbs');
var http = require('http');
var async = require('async');
var _ = require('lodash');
var AppServer = require('./lib/AppServer');
var PagerDutyCalendar = require('./lib/PagerDutyClient/calendar.js');

var server = function() {
    var app = express();
    var httpServer;
    var sync;
    var applicationRoot = __dirname + (process.env.NODE_ENV === 'dev' ? '/' : '/dist/');
    var credentials;
    var calendar;

    app.set('view engine', 'html');
    app.set('views', applicationRoot + 'views');
    app.engine('html', hbs.__express);
    app.use("/static", express.static(applicationRoot + 'static'));

    app.get('/', function(req, res, next) {
        calendar
            .get('PNHU7IO')
            .then(function() {
                return res.render('index.hbs');
            })
            .catch(function(error) {
                console.log(error);

                return res.render('index.hbs');
            });
    });

    return {
        start: function(options, callback) {
            httpServer = new AppServer(app, options);

            async.waterfall([
                    function(callback) {
                        fs.readFile(__dirname + '/credentials.json', 'utf-8', callback);
                    },
                    function(contents, callback) {
                        credentials = JSON.parse(contents);

                        calendar = new PagerDutyCalendar({
                            apiKey: credentials.apiKey,
                            subDomain: credentials.subDomain
                        });

                        callback();
                    },
                    httpServer.start, 
                ],
                function(err, http, socket) {
                    (callback || function() {})(err);
                });
        },
        stop: function(callback) {
            httpServer.stop(callback);
        }
    };
};

if(require.main === module) {
    new server().start({
        port: 1234
    });
}

module.exports = server;
