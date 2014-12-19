var request = require('request');
var Promise = require('bluebird');

module.exports = function(options) {
	return {
		get: function(scheduleId) {
			return new Promise(function(resolve, reject) {
				request('https://' + options.subDomain + '.pagerduty.com/api/v1/schedules/' + scheduleId, {
					headers: {
				        'Authorization': 'Token token=' + options.apiKey
				    }
				}, function (err, response, body) {
					if (!err && response.statusCode == 200) {
						return resolve(JSON.parse(body));
					}

					if(err) {
						return reject(err);
					}

					reject(new Error('Non-200 response code recieved: ' + response.statusCode, {
						statusCode: response.statusCode
					}));
				});
			});
		},
		getOverrides: function(scheduleId, start, end) {
			return new Promise(function(resolve, reject) {
				var url = 'https://' + options.subDomain + '.pagerduty.com/api/v1/schedules/' + scheduleId + '/overrides?since=' + start + '&until=' + end;

				request(url, {
					headers: {
				        'Authorization': 'Token token=' + options.apiKey
				    }
				}, function (err, response, body) {
					if (!err && response.statusCode == 200) {
						return resolve(JSON.parse(body));
					}

					if(err) {
						return reject(err);
					}

					reject(new Error('Non-200 response code recieved: ' + response.statusCode, {
						statusCode: response.statusCode
					}));
				});
			});
		}
	};
};
