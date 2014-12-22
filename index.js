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
    var calendar;

    app.set('view engine', 'html');
    app.set('views', applicationRoot + 'views');
    app.engine('html', hbs.__express);
    app.use("/static", express.static(applicationRoot + 'static'));

    app.get('/', function(req, res, next) {
        var dateSet = getDateSet();
        var focusDate = moment().startOf('isoWeek');
        var scheduleMappers = {
            pagerduty: function(config, dates) {
                return new Promise(function(resolve, reject) {
                    Promise.all([
                        calendar.get(config.scheduleId),
                        calendar.getOverrides(config.scheduleId, dates[0].format('YYYY-MM-DD'), dates[dates.length - 1].format('YYYY-MM-DD'))
                    ]).then(function(results) {
                        var data = results[0];
                        var overrides = _.map(results[1].overrides, function(override) {
                            return {
                                start: moment(override.start, 'YYYY-MM-DD'),
                                end: moment(override.end, 'YYYY-MM-DD'),
                                user: override.user
                            }
                        });

                        var scheduleLayers = data.schedule.schedule_layers;
                        var relevantLayer = _.chain(scheduleLayers).filter(function(layer) {
                            return _.contains(config.layers, layer.id);
                        }).first().value();
                        var rotationUsers = relevantLayer.users;
                        var rotationUserIds = _.map(rotationUsers, function(user) { return user.user.id; });
                        var allUsers = rotationUsers.concat(_.chain(overrides).pluck('user').groupBy('id').map(function(array, key) {
                            return array[0];
                        }).filter(function(user) {
                            return !_.contains(rotationUserIds, user.id);
                        }).map(function(user) {
                            return { user: user };
                        }).value());
                        var layerStart = moment(relevantLayer.rotation_virtual_start, 'YYYY-MM-DD');
                        var rotationLengthInDays = relevantLayer.rotation_turn_length_seconds / 60 / 60 / 24;
                        var offSet = dateSet[0].diff(layerStart, 'days');

                        var onCallAllocation = _.map(dates, function(date, i) {
                            var validOverride = _.chain(overrides).filter(function(override) {
                                return date.diff(override.start) >= 0
                                    && date.diff(override.end) < 0;
                            }).first().value();
                            var onCallUserIndex = Math.floor((i + offSet) / rotationLengthInDays) % rotationUsers.length;

                            if(validOverride) {
                                var matchedUser = _.chain(allUsers).map(function(user) { return user.user.id; }).indexOf(validOverride.user.id).value();

                                onCallUserIndex = matchedUser;
                            }

                            return {
                                date: date,
                                index: i,
                                onCall: onCallUserIndex
                            };
                        });

                        resolve({
                            name: config.name,
                            color: config.color,
                            members: _.map(allUsers, function(user, memberIndex) {
                                return {
                                    name: user.user.name,
                                    email: user.user.email,
                                    dates: _.map(dates, function(date, dateIndex) {
                                        return {
                                            date: date,
                                            onCall: onCallAllocation[dateIndex].onCall === memberIndex
                                        }
                                    })
                                };
                            })
                        });
                    }, reject);
                });
            },
            default: function(config, dates) {
                var members = _.map(config.members, function(member) {
                    return {
                        name: member
                    };
                });

                if(members.length === 1) {
                    members[0].dates = _.map(dates, function(date) {
                        return {
                            date: date,
                            onCall: true
                        }
                    });
                }

                return new Promise(function(resolve, reject) {
                    resolve({
                        name: config.name,
                        color: config.color,
                        members: members
                    });
                });
            }
        };

        Promise.all(_.map(schedules, function(scheduleConfig) {
                return scheduleMappers[scheduleConfig.type || 'default'](scheduleConfig, dateSet);
            }))
            .then(function(scheduleGroups) {
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
