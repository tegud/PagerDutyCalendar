var request = require('request')

module.exports = function(options) {
	return {
		get: function(scheduleId) {
			request('https://' + options.subDomain + '.pagerduty.com/api/v1/schedules/' + scheduleId, {
				headers: {
			        'Authorization': 'Token token=' + options.apiKey
			    }
			}, function (error, response, body) {
				if (!error && response.statusCode == 200) {
					console.log(body);
				}
			});
		}
	};
};
