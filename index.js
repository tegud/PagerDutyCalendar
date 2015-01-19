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
                function correctName(name) {
                    var memberNameSegments = name.split(' ');
                    var memberName = _.map(memberNameSegments, function(segment) {
                        return segment[0].toUpperCase() + segment.substring(1);
                    }).join(' ');

                    return memberName;
                }

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
                        var memberName = correctName(member.name);
                        
                        return {
                            name: memberName,
                            endOfGroup: i === group.members.length - 1,
                            cellColor: group.color
                        };
                    }));
                }, []);

                var onCallToday = [];

                var rows = _.map(dateSet, function(date, dateIndex) {
                    var isToday = date.format('DDMMYYYY') === moment().format('DDMMYYYY');

                    return {
                        isToday: isToday,
                        isFocus: date.format('DDMMYYYY') === focusDate.format('DDMMYYYY'),
                        date: date.format('ddd DD MMM YYYY'),
                        cells: _.reduce(scheduleGroups, function(memo, group) {
                            return memo.concat(_.map(group.members, function(member, memberIndex) {
                                if(isToday && member.dates[dateIndex].onCall) {
                                    onCallToday.push({
                                        groupName: group.name,
                                        color: group.color,
                                        userName: correctName(member.name)
                                    });
                                }

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
                    rows: rows,
                    onCallToday: onCallToday
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
        port: 1236
    });
}

module.exports = server;
