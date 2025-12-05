'use strict';

/**
 * Shared serialization logic for Prometheus metrics.
 * This module is used by both the main thread and worker thread to ensure
 * consistent output format.
 */

const { getValueAsString } = require('./util');

const ESCAPE_STRING_REPLACE_MAP = {
	'\\': '\\\\',
	'\n': '\\n',
};

const ESCAPE_LABEL_VALUE_REPLACE_MAP = {
	...ESCAPE_STRING_REPLACE_MAP,
	'"': '\\"',
};

const ESCAPE_REPLACE_REGEXP = /\\|\n|"/g;

function REPLACE_FUNC(dict) {
	return char => dict[char] || '';
}

/**
 * Escapes special characters in a string for Prometheus format.
 * @param {string} str - The string to escape
 * @param {object} [extraReplaceDict] - Additional replacement dictionary
 * @returns {string} The escaped string
 */
function escapeString(str, extraReplaceDict) {
	const fullDict = extraReplaceDict
		? extraReplaceDict
		: ESCAPE_STRING_REPLACE_MAP;

	return str.replace(ESCAPE_REPLACE_REGEXP, REPLACE_FUNC(fullDict));
}

/**
 * Escapes a label value for Prometheus format.
 * @param {string|number} str - The value to escape
 * @returns {string|number} The escaped value
 */
function escapeLabelValue(str) {
	if (typeof str !== 'string') {
		return str;
	}

	return escapeString(str, ESCAPE_LABEL_VALUE_REPLACE_MAP);
}

/**
 * Formats labels into Prometheus format.
 * @param {object} labels - The labels object
 * @param {object} [exclude] - Labels to exclude (used for sharedLabels)
 * @returns {string[]} Array of formatted label strings
 */
function formatLabels(labels, exclude) {
	const formatted = [];
	for (const [name, value] of Object.entries(labels)) {
		if (!exclude || !Object.hasOwn(exclude, name)) {
			formatted.push(`${name}="${escapeLabelValue(value)}"`);
		}
	}
	return formatted;
}

/**
 * Flattens sharedLabels into a comma-separated string.
 * Used by histograms to avoid duplicating label objects for each bucket.
 * Uses a WeakMap cache for performance.
 */
const sharedLabelCache = new WeakMap();
function flattenSharedLabels(labels) {
	const cached = sharedLabelCache.get(labels);
	if (cached !== undefined) {
		return cached;
	}

	const formattedLabels = formatLabels(labels);
	const flattened = formattedLabels.join(',');
	sharedLabelCache.set(labels, flattened);
	return flattened;
}

/**
 * Standardizes counter name by removing _total suffix.
 * @param {string} name - The metric name
 * @returns {string} The standardized name
 */
function standardizeCounterName(name) {
	return name.replace(/_total$/, '');
}

/**
 * Serializes a single metric to Prometheus text format.
 * @param {object} metric - The metric object with name, help, type, values
 * @param {string} contentType - The content type (Prometheus or OpenMetrics)
 * @param {object} [defaultLabels] - Default labels to apply
 * @returns {string} The serialized metric string
 */
function serializeMetric(metric, contentType, defaultLabels = {}) {
	const isOpenMetrics = contentType.includes('openmetrics');

	const name = escapeString(metric.name);
	const help = `# HELP ${name} ${escapeString(metric.help)}`;
	const type = `# TYPE ${name} ${metric.type}`;
	const values = [help, type];

	let defaultLabelNames = Object.keys(defaultLabels);
	if (defaultLabelNames.length === 0) {
		defaultLabelNames = undefined;
	}

	for (const val of metric.values || []) {
		let { metricName = name, labels = {} } = val;
		const { sharedLabels = {} } = val;

		if (isOpenMetrics && metric.type === 'counter') {
			metricName = `${metricName}_total`;
		}

		if (defaultLabelNames !== undefined) {
			// Make a copy before mutating
			labels = { ...labels };

			for (const labelName of defaultLabelNames) {
				labels[labelName] ??= defaultLabels[labelName];
			}
		}

		// We have to flatten these separately to avoid duplicate labels appearing
		// between the base labels and the shared labels
		const formattedLabels = formatLabels(labels, sharedLabels);

		const flattenedShared = flattenSharedLabels(sharedLabels);
		const labelParts = [...formattedLabels, flattenedShared].filter(Boolean);
		const labelsString = labelParts.length ? `{${labelParts.join(',')}}` : '';
		let fullMetricLine = `${metricName}${labelsString} ${getValueAsString(
			val.value,
		)}`;

		const { exemplar } = val;
		if (exemplar && isOpenMetrics) {
			const formattedExemplars = formatLabels(exemplar.labelSet);
			fullMetricLine += ` # {${formattedExemplars.join(
				',',
			)}} ${getValueAsString(exemplar.value)} ${exemplar.timestamp}`;
		}
		values.push(fullMetricLine);
	}

	return values.join('\n');
}

/**
 * Serializes an array of metrics to Prometheus text format.
 * This is the main entry point for serialization, used by both main thread and worker.
 * @param {object[]} metrics - Array of metric objects from getMetricsAsJSON()
 * @param {string} contentType - The content type (Prometheus or OpenMetrics)
 * @param {object} [defaultLabels] - Default labels to apply
 * @returns {string} The complete serialized metrics string
 */
function serializeMetrics(metrics, contentType, defaultLabels = {}) {
	const isOpenMetrics = contentType.includes('openmetrics');

	const results = metrics.map(metric => {
		// Standardize counter names for OpenMetrics
		if (isOpenMetrics && metric.type === 'counter') {
			metric = { ...metric, name: standardizeCounterName(metric.name) };
		}
		return serializeMetric(metric, contentType, defaultLabels);
	});

	return isOpenMetrics
		? `${results.join('\n')}\n# EOF\n`
		: `${results.join('\n\n')}\n`;
}

module.exports = {
	escapeString,
	escapeLabelValue,
	formatLabels,
	flattenSharedLabels,
	standardizeCounterName,
	serializeMetric,
	serializeMetrics,
	ESCAPE_STRING_REPLACE_MAP,
	ESCAPE_LABEL_VALUE_REPLACE_MAP,
};
