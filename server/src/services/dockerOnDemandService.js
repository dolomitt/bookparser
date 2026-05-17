import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

import { config } from '../config/index.js';

class DockerOnDemandService {
  constructor() {
    this.locks = new Map();
    this.idleTimers = new Map();
  }

  get enabled() {
    return Boolean(config.dockerOnDemand.enabled);
  }

  async ensureS2Pro() {
    return this.ensureService({
      key: 's2-pro',
      service: config.dockerOnDemand.s2ProService,
      profile: config.dockerOnDemand.s2ProProfile,
      url: config.s2Pro.baseUrl,
      healthType: 'tcp'
    });
  }

  async ensureQwenAligner() {
    return this.ensureService({
      key: 'qwen-aligner',
      service: config.dockerOnDemand.qwenAlignerService,
      profile: config.dockerOnDemand.qwenAlignerProfile,
      url: `${config.qwenAligner.baseUrl}/health`,
      healthType: 'http'
    });
  }

  scheduleS2ProIdleStop() {
    this.scheduleIdleStop('s2-pro', config.dockerOnDemand.s2ProService, config.dockerOnDemand.s2ProProfile);
  }

  scheduleQwenAlignerIdleStop() {
    this.scheduleIdleStop('qwen-aligner', config.dockerOnDemand.qwenAlignerService, config.dockerOnDemand.qwenAlignerProfile);
  }

  async ensureService({ key, service, profile, url, healthType }) {
    if (!this.enabled) return;

    this.clearIdleTimer(key);

    if (await this.isHealthy(url, healthType)) {
      return;
    }

    if (!this.locks.has(key)) {
      this.locks.set(key, this.startAndWait({ key, service, profile, url, healthType })
        .finally(() => this.locks.delete(key)));
    }

    return this.locks.get(key);
  }

  async startAndWait({ key, service, profile, url, healthType }) {
    console.log(`[DockerOnDemand] Starting ${service} for ${key}`);
    await this.runCompose(['--profile', profile, 'up', '-d', service]);
    await this.waitForHealth(url, healthType, config.dockerOnDemand.startTimeout);
    console.log(`[DockerOnDemand] ${service} is ready`);
  }

  scheduleIdleStop(key, service, profile) {
    if (!this.enabled || config.dockerOnDemand.idleStopMs <= 0) return;

    this.clearIdleTimer(key);
    const timer = setTimeout(() => {
      this.idleTimers.delete(key);
      this.stopService(key, service, profile).catch((error) => {
        console.warn(`[DockerOnDemand] Failed to stop ${service}: ${error.message}`);
      });
    }, config.dockerOnDemand.idleStopMs);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    this.idleTimers.set(key, timer);
  }

  async stopService(key, service, profile) {
    if (this.locks.has(key)) return;
    console.log(`[DockerOnDemand] Stopping idle ${service}`);
    await this.runCompose(['--profile', profile, 'stop', service]);
  }

  clearIdleTimer(key) {
    const timer = this.idleTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(key);
    }
  }

  async waitForHealth(url, healthType, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;

    while (Date.now() < deadline) {
      try {
        if (await this.isHealthy(url, healthType)) {
          return;
        }
      } catch (error) {
        lastError = error;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ''}`);
  }

  async isHealthy(url, healthType) {
    if (healthType === 'tcp') {
      return this.canOpenTcp(url, 1200);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    try {
      const response = await fetch(url, { signal: controller.signal });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  canOpenTcp(url, timeoutMs) {
    return new Promise((resolve) => {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        resolve(false);
        return;
      }

      const socket = net.createConnection({
        host: parsed.hostname,
        port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))
      });

      const finish = (healthy) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(healthy);
      };

      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });
  }

  runCompose(args) {
    const composeFile = path.resolve(process.cwd(), config.dockerOnDemand.composeFile);
    const composeArgs = ['compose', '-f', composeFile, ...args];

    return new Promise((resolve, reject) => {
      const child = spawn(config.dockerOnDemand.command, composeArgs, {
        cwd: path.dirname(composeFile),
        windowsHide: true
      });
      let stderr = '';

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`${config.dockerOnDemand.command} ${composeArgs.join(' ')} failed (${code}): ${stderr.trim()}`));
      });
    });
  }
}

export default new DockerOnDemandService();
