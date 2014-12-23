var express = require('express');
var fs = require('fs');
var hbs = require('hbs');
var http = require('http');
var async = require('async');
var _ = require('lodash');
var moment = require('moment');
var Promise = require('bluebird');

var AppServer = require('./lib/AppServer');
var PagerDutyCalendar = require('./lib/PagerDutyClient/calendar.js');
var PagerDutyCalendarMapper = require('./lib/mappers/pagerduty.js');

var scheduleMappers = {
    default: require('./lib/mappers/default.js')
}; 

function getDateSet(start) {
    var dates = [];
    var today = moment();
    var niceStart = moment(today).startOf('month').add(-1, 'months');
    if(!start) {
        start = niceStart;
    }
    var end = moment(niceStart).add(3, 'months');
    var currentDate = moment(start);

    while(end.diff(currentDate) > 0) {
        dates.push(currentDate);

        currentDate = moment(currentDate).add(1, 'day');
    }

    return dates;
}

var server = function() {
    var app = express();
    var httpServer;
    var sync;
    var applicationRoot = __dirname + (process.env.NODE_ENV === 'dev' ? '/' : '/dist/');
    var credentials;
    var schedules;

    app.set('view engine', 'html');
    app.set('views', applicationRoot + 'views');
    app.engine('html', hbs.__express);
    app.use("/static", express.static(applicationRoot + 'static'));

    app.get('/', function(req, res, next) {
        var dateSet = getDateSet();
        var focusDate = moment().startOf('isoWeek');

        Promise.all(_.map(schedules, function(scheduleConfig) {
                return scheduleMappers[scheduleConfig.type || 'default'](scheduleConfig, dateSet);
            }))
            .then(function(scheduleGroups) {
                var headers = _.chain(scheduleGroups).filter(function(group) {
                    return group.members.length > 0;
                }).map(function(group) {
                    return {
                        name: group.name,
                        colspan: group.members.length,
                        spansMultiple: group.members.length > 1,
                        cellColor: group.color
                    };
                }).value();

                var peopleHeaders = _.reduce(scheduleGroups, function(memo, group) {
                    return memo.concat(_.map(group.members, function(member, i) {
                        return {
                            name: member.name,
                            endOfGroup: i === group.members.length - 1,
                            cellColor: group.color
                        };
                    }));
                }, []);

                var rows = _.map(dateSet, function(date, dateIndex) {
                    return {
                        isToday: date.format('DDMMYYYY') === moment().format('DDMMYYYY'),
                        isFocus: date.format('DDMMYYYY') === focusDate.format('DDMMYYYY'),
                        date: date.format('ddd DD MMM YYYY'),
                        cells: _.reduce(scheduleGroups, function(memo, group) {
                            return memo.concat(_.map(group.members, function(member, memberIndex) {
                                return {
                                    endOfGroup: memberIndex === group.members.length - 1,
                                    cellColor: group.color,
                                    isOnCall: member.dates[dateIndex].onCall
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
                    async.apply(async.parallel, [
                        async.apply(fs.readFile, __dirname + '/credentials.json', 'utf-8'),
                        async.apply(fs.readFile, __dirname + '/schedules.json', 'utf-8')
                    ]),
                    function(results, callback) {
                        credentials = JSON.parse(results[0]);
                        schedules = JSON.parse(results[1]);

                        scheduleMappers.pagerduty = new PagerDutyCalendarMapper(credentials);

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
