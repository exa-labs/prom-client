'use strict';

/**
 * Tests for worker thread metrics serialization.
 * Verifies byte-for-byte equality between worker and non-worker paths.
 *
 * Header author: Devin (Cognition AI)
 */

const Registry = require('../index').Registry;
const Counter = require('../index').Counter;
const Gauge = require('../index').Gauge;
const Histogram = require('../index').Histogram;
const Summary = require('../index').Summary;
const { canUseWorkers, terminateWorker } = require('../lib/metricsWorker');

describe('Worker Thread Serialization', () => {
	afterAll(async () => {
		// Clean up worker thread after all tests
		await terminateWorker();
	});

	describe.each([
		['Prometheus', Registry.PROMETHEUS_CONTENT_TYPE],
		['OpenMetrics', Registry.OPENMETRICS_CONTENT_TYPE],
	])('with %s content type', (tag, regType) => {
		let registry;

		beforeEach(() => {
			registry = new Registry(regType);
		});

		afterEach(() => {
			registry.clear();
		});

		it('should check if worker threads are available', () => {
			// This test just verifies the function exists and returns a boolean
			expect(typeof canUseWorkers()).toBe('boolean');
		});

		it('should produce identical output for counter metrics', async () => {
			const counter = new Counter({
				name: 'test_counter',
				help: 'A test counter',
				labelNames: ['label', 'code'],
				registers: [registry],
			});

			counter.inc({ label: 'hello', code: '200' }, 5);
			counter.inc({ label: 'world', code: '404' }, 10);

			const nonWorkerOutput = await registry.metrics();
			const workerOutput = await registry.metrics({ useWorkerThreads: true });

			expect(workerOutput).toEqual(nonWorkerOutput);
		});

		it('should produce identical output for gauge metrics', async () => {
			const gauge = new Gauge({
				name: 'test_gauge',
				help: 'A test gauge',
				labelNames: ['level'],
				registers: [registry],
			});

			gauge.set({ level: 'high' }, 100);
			gauge.set({ level: 'low' }, -50);

			const nonWorkerOutput = await registry.metrics();
			const workerOutput = await registry.metrics({ useWorkerThreads: true });

			expect(workerOutput).toEqual(nonWorkerOutput);
		});

		it('should produce identical output for histogram metrics with sharedLabels', async () => {
			const histogram = new Histogram({
				name: 'test_histogram',
				help: 'A test histogram',
				labelNames: ['method', 'path'],
				buckets: [0.1, 0.5, 1, 5, 10],
				registers: [registry],
			});

			histogram.observe({ method: 'GET', path: '/api' }, 0.3);
			histogram.observe({ method: 'POST', path: '/api' }, 1.5);
			histogram.observe({ method: 'GET', path: '/api' }, 0.8);

			const nonWorkerOutput = await registry.metrics();
			const workerOutput = await registry.metrics({ useWorkerThreads: true });

			expect(workerOutput).toEqual(nonWorkerOutput);
		});

		it('should produce identical output for summary metrics', async () => {
			const summary = new Summary({
				name: 'test_summary',
				help: 'A test summary',
				labelNames: ['quantile_label'],
				percentiles: [0.5, 0.9, 0.99],
				registers: [registry],
			});

			summary.observe({ quantile_label: 'test' }, 100);
			summary.observe({ quantile_label: 'test' }, 200);
			summary.observe({ quantile_label: 'test' }, 300);

			const nonWorkerOutput = await registry.metrics();
			const workerOutput = await registry.metrics({ useWorkerThreads: true });

			expect(workerOutput).toEqual(nonWorkerOutput);
		});

		it('should produce identical output with default labels', async () => {
			registry.setDefaultLabels({ env: 'test', version: '1.0.0' });

			const counter = new Counter({
				name: 'labeled_counter',
				help: 'Counter with default labels',
				labelNames: ['action'],
				registers: [registry],
			});

			counter.inc({ action: 'click' }, 1);

			const nonWorkerOutput = await registry.metrics();
			const workerOutput = await registry.metrics({ useWorkerThreads: true });

			expect(workerOutput).toEqual(nonWorkerOutput);
		});

		it('should produce identical output with special characters in labels', async () => {
			const gauge = new Gauge({
				name: 'special_chars_gauge',
				help: 'Gauge with special characters',
				labelNames: ['path'],
				registers: [registry],
			});

			gauge.set({ path: '/api/v1?foo=bar&baz="qux"' }, 42);
			gauge.set({ path: 'line1\nline2' }, 100);
			gauge.set({ path: 'back\\slash' }, 200);

			const nonWorkerOutput = await registry.metrics();
			const workerOutput = await registry.metrics({ useWorkerThreads: true });

			expect(workerOutput).toEqual(nonWorkerOutput);
		});

		it('should produce identical output with multiple metric types', async () => {
			const counter = new Counter({
				name: 'multi_counter',
				help: 'A counter',
				registers: [registry],
			});
			const gauge = new Gauge({
				name: 'multi_gauge',
				help: 'A gauge',
				registers: [registry],
			});
			const histogram = new Histogram({
				name: 'multi_histogram',
				help: 'A histogram',
				registers: [registry],
			});

			counter.inc(5);
			gauge.set(42);
			histogram.observe(0.5);

			const nonWorkerOutput = await registry.metrics();
			const workerOutput = await registry.metrics({ useWorkerThreads: true });

			expect(workerOutput).toEqual(nonWorkerOutput);
		});

		it('should produce identical output with NaN and Infinity values', async () => {
			const gauge = new Gauge({
				name: 'special_values_gauge',
				help: 'Gauge with special values',
				labelNames: ['type'],
				registers: [registry],
			});

			gauge.set({ type: 'nan' }, NaN);
			gauge.set({ type: 'pos_inf' }, Infinity);
			gauge.set({ type: 'neg_inf' }, -Infinity);

			const nonWorkerOutput = await registry.metrics();
			const workerOutput = await registry.metrics({ useWorkerThreads: true });

			expect(workerOutput).toEqual(nonWorkerOutput);
		});

		it('should handle empty registry', async () => {
			const nonWorkerOutput = await registry.metrics();
			const workerOutput = await registry.metrics({ useWorkerThreads: true });

			expect(workerOutput).toEqual(nonWorkerOutput);
		});

		it('should handle metrics without labels', async () => {
			const counter = new Counter({
				name: 'no_labels_counter',
				help: 'Counter without labels',
				registers: [registry],
			});

			counter.inc(10);

			const nonWorkerOutput = await registry.metrics();
			const workerOutput = await registry.metrics({ useWorkerThreads: true });

			expect(workerOutput).toEqual(nonWorkerOutput);
		});
	});
});
