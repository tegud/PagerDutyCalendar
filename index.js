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
    var calendar;

    app.set('view engine', 'html');
    app.set('views', applicationRoot + 'views');
    app.engine('html', hbs.__express);
    app.use("/static", express.static(applicationRoot + 'static'));

    app.get('/', function(req, res, next) {
        var dateSet = getDateSet();

        Promise.all([
                calendar.get('PNHU7IO'),
                calendar.getOverrides('PNHU7IO', dateSet[0].format('YYYY-MM-DD'), dateSet[dateSet.length - 1].format('YYYY-MM-DD'))
            ])
           .then(function(results) {
                var data = results[0];
                var overrides = _.map(results[1].overrides, function(override) {
                    return {
                        start: moment(override.start, 'YYYY-MM-DD'),
                        end: moment(override.end, 'YYYY-MM-DD'),
                        user: override.user
                    }
                });

                console.log(JSON.stringify(overrides ,null, 4));

                var scheduleLayers = data.schedule.schedule_layers;

                var onCallLayer = _.chain(scheduleLayers).filter(function(layer) {
                    return _.filter(layer.users, function(user) {
                        return user.user.name === 'ITSupport';
                    }).length === 0;
                }).first().value();

                var rotationUsers = onCallLayer.users;
                var rotationUserIds = _.map(rotationUsers, function(user) { return user.user.id; });
                var allUsers = rotationUsers.concat(_.chain(overrides).pluck('user').groupBy('id').map(function(array, key) {
                    return array[0];
                }).filter(function(user) {
                    return !_.contains(rotationUserIds, user.id);
                }).map(function(user) {
                    return { user: user };
                }).value());

                var layerStart = moment(onCallLayer.rotation_virtual_start, 'YYYY-MM-DD');
                var rotationLengthInDays = onCallLayer.rotation_turn_length_seconds / 60 / 60 / 24;
                var offSet = dateSet[0].diff(layerStart, 'days');

                var onCallAllocation = _.map(dateSet, function(date, i) {
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

                function isOnCall(dateIndex, memberIndex) {
                    return onCallAllocation[dateIndex].onCall === memberIndex;
                }

                var scheduleGroups = [
                    {
                        name: 'Level 1 - Duty Manager',
                        color: '#f00',
                        members: _.map(allUsers, function(user) { return user.user.name; })
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

                var rows = _.map(dateSet, function(date, dateIndex) {
                    return {
                        date: date.format('ddd DD MMM YYYY'),
                        cells: _.reduce(scheduleGroups, function(memo, group) {
                            return memo.concat(_.map(group.members, function(member, memberIndex) {
                                var isOnCallThisDay = group.members.length === 1;

                                if(group.name === 'Level 1 - Duty Manager') {
                                    isOnCallThisDay = isOnCall(dateIndex, memberIndex);
                                }

                                return {
                                    endOfGroup: memberIndex === group.members.length - 1,
                                    cellColor: group.color,
                                    isOnCall: isOnCallThisDay
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
