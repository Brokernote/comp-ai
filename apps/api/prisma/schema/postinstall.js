#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePrismaClient = generatePrismaClient;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const executableName = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
function generatePrismaClient(options = {}) {
    const projectRoot = options.projectRoot ?? process.cwd();
    const log = options.log ?? ((message) => console.log(`[prisma-postinstall] ${message}`));
    const resolution = resolveSchemaPath(projectRoot);
    if (!resolution.path) {
        throw new Error([
            'Unable to locate schema.prisma from @trycompai/db.',
            'Looked in the following locations:',
            ...resolution.searched.map((candidate) => ` - ${candidate}`),
        ].join('\n'));
    }
    const schemaDir = (0, node_path_1.resolve)(projectRoot, 'prisma');
    const schemaDestination = (0, node_path_1.resolve)(schemaDir, 'schema.prisma');
    (0, node_fs_1.mkdirSync)(schemaDir, { recursive: true });
    (0, node_fs_1.copyFileSync)(resolution.path, schemaDestination);
    log(`Copied schema from ${resolution.path} to ${schemaDestination}`);
    const clientEntryPoint = (0, node_path_1.resolve)(projectRoot, 'node_modules/.prisma/client/default.js');
    if (!options.force && (0, node_fs_1.existsSync)(clientEntryPoint)) {
        log('Prisma client already exists. Skipping generation.');
        return { schema: schemaDestination };
    }
    const prismaBinary = resolvePrismaBinary(projectRoot);
    if (!prismaBinary) {
        throw new Error([
            'Prisma CLI not found in this workspace. Ensure "prisma" is installed.',
            `Checked paths:`,
            ...buildBinaryCandidates(projectRoot).map((candidate) => ` - ${candidate}`),
        ].join('\n'));
    }
    log('Generating Prisma client for Trigger deploy...');
    const result = (0, node_child_process_1.spawnSync)(prismaBinary, ['generate', `--schema=${schemaDestination}`], {
        cwd: projectRoot,
        stdio: 'inherit',
        env: {
            ...process.env,
            PRISMA_HIDE_UPDATE_MESSAGE: '1',
        },
    });
    if (result.status !== 0) {
        throw new Error(`Prisma generate exited with code ${result.status ?? -1}`);
    }
    log('Prisma client generation complete.');
    return { schema: schemaDestination };
}
function resolveSchemaPath(projectRoot) {
    const candidates = buildSchemaCandidates(projectRoot);
    const path = candidates.find((candidate) => (0, node_fs_1.existsSync)(candidate));
    return { path, searched: candidates };
}
function buildSchemaCandidates(projectRoot) {
    const candidates = new Set();
    const addCandidates = (start) => {
        if (!start) {
            return;
        }
        let current = start;
        while (true) {
            candidates.add((0, node_path_1.resolve)(current, 'node_modules/@trycompai/db/dist/schema.prisma'));
            const parent = (0, node_path_1.dirname)(current);
            if (parent === current) {
                break;
            }
            current = parent;
        }
    };
    addCandidates(projectRoot);
    const initCwd = process.env.INIT_CWD;
    if (initCwd && initCwd !== projectRoot) {
        addCandidates(initCwd);
    }
    candidates.add((0, node_path_1.resolve)(projectRoot, '../../packages/db/dist/schema.prisma'));
    candidates.add((0, node_path_1.resolve)(projectRoot, '../packages/db/dist/schema.prisma'));
    return Array.from(candidates);
}
function resolvePrismaBinary(projectRoot) {
    const candidates = buildBinaryCandidates(projectRoot);
    return candidates.find((candidate) => (0, node_fs_1.existsSync)(candidate));
}
function buildBinaryCandidates(projectRoot) {
    const candidates = new Set();
    const addCandidates = (start) => {
        if (!start) {
            return;
        }
        let current = start;
        while (true) {
            candidates.add((0, node_path_1.resolve)(current, 'node_modules', '.bin', executableName));
            const parent = (0, node_path_1.dirname)(current);
            if (parent === current) {
                break;
            }
            current = parent;
        }
    };
    addCandidates(projectRoot);
    const initCwd = process.env.INIT_CWD;
    if (initCwd && initCwd !== projectRoot) {
        addCandidates(initCwd);
    }
    return Array.from(candidates);
}
function shouldRunCli(force) {
    if (force) {
        return true;
    }
    if (process.env.TRIGGER_PRISMA_FORCE_GENERATE === '1') {
        return true;
    }
    return Boolean(process.env.TRIGGER_SECRET_KEY ||
        process.env.TRIGGER_DEPLOYMENT ||
        process.env.CI === 'true' ||
        process.env.PRISMA_GENERATE_ON_INSTALL === '1');
}
function runCli() {
    const force = process.argv.includes('--force');
    if (!shouldRunCli(force)) {
        process.exit(0);
    }
    try {
        generatePrismaClient({ projectRoot: process.cwd(), force });
    }
    catch (error) {
        console.error('[prisma-postinstall] Failed to generate Prisma client:', error);
        process.exit(1);
    }
}
const executedAsScript = typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module;
if (executedAsScript) {
    runCli();
}
