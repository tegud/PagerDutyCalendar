var Promise = require('bluebird');
var _ = require('lodash');

module.exports = function(config, dates) {
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
};
