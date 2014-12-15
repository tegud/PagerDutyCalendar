var express = require('express');
var fs = require('fs');
var hbs = require('hbs');
var http = require('http');
var async = require('async');
var _ = require('lodash');
var moment = require('moment');

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
        //calendar
        //    .get('PNHU7IO')
        //    .then(function(data) {
                var scheduleGroups = [
                    {
                        name: 'Level 1 - Duty Manager',
                        color: '#f00',
                        members: [
                            'Duty Manager 1',
                            'Duty Manager 2',
                            'Duty Manager 3',
                            'Duty Manager 4'
                        ]
                    },
                    {
                        name: 'Level 2 - Database Support',
                        color: '#B3A2C7',
                        members: [
                            'Database 1',
                            'Database 2'
                        ]
                    },
                    {
                        name: 'Level 2 - System Support',
                        color: '#00B050',
                        members: [
                            'System 1',
                            'System 2'
                        ]
                    },
                    {
                        name: 'Level 2 - Network Support',
                        color: '#92D050',
                        members: [
                            'Network 1',
                            'Network 2'
                        ]
                    },
                    {
                        name: 'Level 2 - Application Support',
                        color: '#00B0F0',
                        members: [
                            'Application 1',
                            'Application 2'
                        ]
                    },
                    {
                        name: 'Level 3',
                        color: '#FF66FF',
                        members: [
                            'Level 3 1',
                            'Level 3 2'
                        ]
                    },
                    {
                        name: 'Level 4',
                        color: '#FF9966',
                        members: [
                            'Level 4'
                        ]
                    }
                ];

                var headers = _.map(scheduleGroups, function(group) {
                    return {
                        name: group.name,
                        colspan: group.members.length,
                        spansMultiple: group.members.length > 1,
                        cellColor: group.color
                    };
                });

                var peopleHeaders = _.reduce(scheduleGroups, function(memo, group) {
                    return memo.concat(_.map(group.members, function(member, i) {
                        return {
                            name: member,
                            endOfGroup: i === group.members.length - 1,
                            cellColor: group.color
                        };
                    }));
                }, []);

                var dates = ['13 dec 2014', '14 dec 2014', '15 dec 2014'];

                var rows = _.map(dates, function(date) {
                    return {
                        date: date,
                        cells: _.reduce(scheduleGroups, function(memo, group) {
                            return memo.concat(_.map(group.members, function(member, i) {
                                return {
                                    endOfGroup: i === group.members.length - 1,
                                    cellColor: group.color,
                                    isOnCall: group.members.length === 1
                                };
                            }));
                        }, [])
                    };
                });

                return res.render('index.hbs', {
                    headers: headers,
                    peopleHeaders: peopleHeaders,
                    rows: rows
                });
            // })
            // .catch(function(error) {
            //     console.log(error);

            //     return res.render('index.hbs');
            // });
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
