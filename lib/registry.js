'use strict';

const { serializeMetric, serializeMetrics } = require('./serialize');
const { canUseWorkers, serializeWithWorker } = require('./metricsWorker');

class Registry {
	static get PROMETHEUS_CONTENT_TYPE() {
		return 'text/plain; version=0.0.4; charset=utf-8';
	}

	static get OPENMETRICS_CONTENT_TYPE() {
		return 'application/openmetrics-text; version=1.0.0; charset=utf-8';
	}

	constructor(regContentType = Registry.PROMETHEUS_CONTENT_TYPE) {
		this._metrics = new Map();
		this._collectors = [];
		this._defaultLabels = {};
		if (
			regContentType !== Registry.PROMETHEUS_CONTENT_TYPE &&
			regContentType !== Registry.OPENMETRICS_CONTENT_TYPE
		) {
			throw new TypeError(`Content type ${regContentType} is unsupported`);
		}
		this._contentType = regContentType;
	}

	/**
	 * Return all metrics
	 *
	 * @returns {object[]}
	 */

	getMetricsAsArray() {
		return Array.from(this._metrics.values());
	}

	async getMetricsAsString(metrics) {
		const metric =
			typeof metrics.getForPromString === 'function'
				? await metrics.getForPromString()
				: await metrics.get();

		return serializeMetric(metric, this.contentType, this._defaultLabels);
	}

	/**
	 * Get string representation for all metrics.
	 * @param {object} [options] - Options for metrics serialization
	 * @param {boolean} [options.useWorkerThreads] - Use worker thread for serialization
	 * @returns {Promise<string>} The serialized metrics string
	 */
	async metrics(options) {
		const useWorker = options?.useWorkerThreads === true && canUseWorkers();
		const metricsSnapshot = await this.getMetricsAsJSONForWorker();

		if (useWorker) {
			return serializeWithWorker(
				metricsSnapshot,
				this.contentType,
				this._defaultLabels,
			);
		}

		return serializeMetrics(
			metricsSnapshot,
			this.contentType,
			this._defaultLabels,
		);
	}

	registerMetric(metric) {
		const existing = this._metrics.get(metric.name);
		if (existing !== undefined && existing !== metric) {
			throw new Error(
				`A metric with the name ${metric.name} has already been registered.`,
			);
		}

		this._metrics.set(metric.name, metric);
	}

	clear() {
		this._metrics = new Map();
		this._defaultLabels = {};
	}

	/**
	 * Get metrics as JSON, applying default labels.
	 * This is the public API that applies default labels to the values.
	 * @returns {Promise<object[]>}
	 */
	async getMetricsAsJSON() {
		const metrics = [];
		let defaultLabelNames = Object.keys(this._defaultLabels);
		if (defaultLabelNames.length === 0) {
			defaultLabelNames = undefined;
		}

		const promises = [];

		for (const metric of this.getMetricsAsArray()) {
			promises.push(metric.get());
		}

		const resolves = await Promise.all(promises);

		for (const item of resolves) {
			if (defaultLabelNames !== undefined && item.values !== undefined) {
				for (const val of item.values) {
					// Make a copy before mutating
					val.labels = { ...val.labels };

					for (const labelName of defaultLabelNames) {
						val.labels[labelName] ??= this._defaultLabels[labelName];
					}
				}
			}

			metrics.push(item);
		}

		return metrics;
	}

	/**
	 * Get metrics as JSON for worker thread serialization.
	 * Uses getForPromString() when available to preserve sharedLabels structure.
	 * Does NOT apply default labels here - they are passed separately to the worker.
	 * @returns {Promise<object[]>}
	 */
	async getMetricsAsJSONForWorker() {
		const promises = [];

		for (const metric of this.getMetricsAsArray()) {
			// Use getForPromString when available to preserve sharedLabels structure
			const getData =
				typeof metric.getForPromString === 'function'
					? metric.getForPromString()
					: metric.get();
			promises.push(getData);
		}

		return Promise.all(promises);
	}

	removeSingleMetric(name) {
		this._metrics.delete(name);
	}

	getSingleMetricAsString(name) {
		return this.getMetricsAsString(this._metrics.get(name));
	}

	getSingleMetric(name) {
		return this._metrics.get(name);
	}

	setDefaultLabels(labels) {
		this._defaultLabels = labels;
	}

	resetMetrics() {
		for (const metric of this._metrics.values()) {
			metric.reset();
		}
	}

	get contentType() {
		return this._contentType;
	}

	setContentType(metricsContentType) {
		if (
			metricsContentType === Registry.OPENMETRICS_CONTENT_TYPE ||
			metricsContentType === Registry.PROMETHEUS_CONTENT_TYPE
		) {
			this._contentType = metricsContentType;
		} else {
			throw new Error(`Content type ${metricsContentType} is unsupported`);
		}
	}

	static merge(registers) {
		const regType = registers[0].contentType;
		for (const reg of registers) {
			if (reg.contentType !== regType) {
				throw new Error(
					'Registers can only be merged if they have the same content type',
				);
			}
		}
		const mergedRegistry = new Registry(regType);

		const metricsToMerge = registers.reduce(
			(acc, reg) => acc.concat(reg.getMetricsAsArray()),
			[],
		);

		metricsToMerge.forEach(mergedRegistry.registerMetric, mergedRegistry);
		return mergedRegistry;
	}
}

module.exports = Registry;
module.exports.globalRegistry = new Registry();
