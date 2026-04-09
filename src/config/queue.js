'use strict';

const { Queue, Worker, QueueEvents } = require('bullmq');
const { getRedisClient } = require('./redis');

let queues = {};

/**
 * Ensures a queue exists and returns it.
 */
const getQueue = (name) => {
  if (!queues[name]) {
    const connection = getRedisClient();
    queues[name] = new Queue(name, { connection });
  }
  return queues[name];
};

/**
 * Standard queues
 */
const QUEUES = {
  TIMER_EXPIRY: 'timer-expiry',
  NOTIFICATIONS: 'notifications',
  OCR_PROCESSING: 'ocr-processing',
  RECONCILIATION: 'reconciliation',
};

/**
 * Creates a configured worker for a specific queue
 */
const createWorker = (queueName, processor, options = {}) => {
  const connection = getRedisClient();
  
  const worker = new Worker(queueName, processor, {
    connection,
    concurrency: options.concurrency || 1,
    ...options
  });

  worker.on('failed', (job, err) => {
    console.error(`[BullMQ] Job ${job?.id} in ${queueName} failed:`, err.message);
  });

  return worker;
};

module.exports = {
  getQueue,
  createWorker,
  QUEUES,
};
