'use strict';

/**
 * Worker thread script for metrics serialization.
 * This script runs in a separate thread and handles serialization requests
 * from the main thread.
 */

const { parentPort } = require('worker_threads');
const { serializeMetrics } = require('./serialize');

// Message handler for serialization requests
parentPort.on('message', request => {
	if (request.type === 'serialize') {
		try {
			const text = serializeMetrics(
				request.metrics,
				request.contentType,
				request.defaultLabels,
			);
			parentPort.postMessage({
				type: 'result',
				id: request.id,
				text,
			});
		} catch (error) {
			parentPort.postMessage({
				type: 'result',
				id: request.id,
				text: '',
				error: error.message || String(error),
			});
		}
	}
});
