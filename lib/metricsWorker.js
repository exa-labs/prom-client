'use strict';

/**
 * Worker thread manager for metrics serialization.
 * Provides a singleton worker that handles serialization requests.
 */

const path = require('path');

// Lazy-load worker_threads to handle environments where it's not available
let Worker;
let workerThreadsAvailable = false;

try {
	({ Worker } = require('worker_threads'));
	workerThreadsAvailable = true;
} catch {
	Worker = null;
	workerThreadsAvailable = false;
}

/**
 * Check if worker threads are available in this environment.
 * @returns {boolean}
 */
function canUseWorkers() {
	return workerThreadsAvailable && Worker !== null;
}

// Singleton worker instance
let worker = null;
let requestId = 0;
const pendingRequests = new Map();

/**
 * Initialize the worker thread if not already running.
 */
function initWorker() {
	if (worker !== null || !canUseWorkers()) {
		return;
	}

	const workerScriptPath = path.join(__dirname, 'metricsWorkerScript.js');
	worker = new Worker(workerScriptPath);

	worker.on('message', response => {
		const pending = pendingRequests.get(response.id);
		if (pending !== undefined) {
			pendingRequests.delete(response.id);
			if (response.error !== undefined) {
				pending.reject(new Error(response.error));
			} else {
				pending.resolve(response.text);
			}
		}
	});

	worker.on('error', error => {
		// Reject all pending requests
		for (const [id, pending] of pendingRequests) {
			pending.reject(error);
			pendingRequests.delete(id);
		}
		// Reset worker so it can be restarted
		worker = null;
	});

	worker.on('exit', code => {
		if (code !== 0) {
			// Reject all pending requests on abnormal exit
			const exitError = new Error(`Worker exited with code ${code}`);
			for (const [id, pending] of pendingRequests) {
				pending.reject(exitError);
				pendingRequests.delete(id);
			}
		}
		worker = null;
	});
}

/**
 * Serialize metrics using the worker thread.
 * @param {object[]} metrics - Array of metric objects from getMetricsAsJSON()
 * @param {string} contentType - The content type (Prometheus or OpenMetrics)
 * @param {object} [defaultLabels] - Default labels to apply
 * @returns {Promise<string>} The serialized metrics string
 */
async function serializeWithWorker(metrics, contentType, defaultLabels = {}) {
	if (!canUseWorkers()) {
		throw new Error('Worker threads are not available in this environment');
	}

	initWorker();

	const id = requestId++;

	return new Promise((resolve, reject) => {
		pendingRequests.set(id, { resolve, reject });

		worker.postMessage({
			type: 'serialize',
			id,
			metrics,
			contentType,
			defaultLabels,
		});
	});
}

/**
 * Terminate the worker thread.
 * @returns {Promise<void>}
 */
async function terminateWorker() {
	if (worker !== null) {
		await worker.terminate();
		worker = null;
	}
}

module.exports = {
	canUseWorkers,
	serializeWithWorker,
	terminateWorker,
};
