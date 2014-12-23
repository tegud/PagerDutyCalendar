var Promise = require('bluebird');
var moment = require('moment');
var _ = require('lodash');

var PagerDutyCalendar = require('../PagerDutyClient/calendar.js');

module.exports =  function(credentials) {
    var calendar = new PagerDutyCalendar({
        apiKey: credentials.apiKey,
        subDomain: credentials.subDomain
    });

    return function(config, dates) {
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

                if(!relevantLayer) {
                    console.log(scheduleLayers);
                }
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
                var offSet = dates[0].diff(layerStart, 'days');

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
    };
};
