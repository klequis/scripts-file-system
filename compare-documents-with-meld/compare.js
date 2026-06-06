#!/usr/bin/env node
'use strict';

const { spawnSync, spawn } = require('child_process');
const { existsSync } = require('fs');

const LABEL       = 'A1-2026-05';
const DEVICE      = `/dev/disk/by-label/${LABEL}`;
const MOUNT_POINT = `/run/media/carl/${LABEL}`;
const FOLDER1     = '/home/carl/Documents';
const FOLDER2     = `${MOUNT_POINT}/Documents`;

function isMounted() {
  const result = spawnSync('findmnt', ['--noheadings', '--output', 'TARGET', MOUNT_POINT], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.stdout && result.stdout.toString().trim() === MOUNT_POINT;
}

function abort(message) {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

if (!isMounted()) {
  if (!existsSync(DEVICE)) {
    abort(`Drive with label "${LABEL}" not found. Is the drive plugged in?`);
  }

  console.log(`Drive not mounted. Attempting to mount "${LABEL}"...`);

  // Try direct mount first (works for unencrypted drives)
  let mountResult = spawnSync('udisksctl', ['mount', '-b', DEVICE], { stdio: 'inherit' });

  if (mountResult.status !== 0) {
    // Drive may be LUKS-encrypted — unlock first (prompts for passphrase)
    console.log('Direct mount failed. Trying LUKS unlock (you will be prompted for the passphrase)...');

    const unlock = spawnSync('udisksctl', ['unlock', '-b', DEVICE], {
      stdio: ['inherit', 'pipe', 'inherit'],
    });

    if (unlock.status !== 0) {
      abort('Failed to unlock or mount the drive.');
    }

    // udisksctl unlock prints: "Unlocked /dev/xxx as /dev/dm-N."
    const unlockOutput = unlock.stdout ? unlock.stdout.toString().trim() : '';
    const match = unlockOutput.match(/as\s+(\/dev\/\S+)\./);
    if (!match) {
      abort('Unlocked the drive but could not determine the cleartext device path.');
    }
    const cleartextDevice = match[1];

    mountResult = spawnSync('udisksctl', ['mount', '-b', cleartextDevice], { stdio: 'inherit' });
    if (mountResult.status !== 0) {
      abort('Failed to mount the unlocked drive.');
    }
  }

  if (!isMounted()) {
    abort('Mount appeared to succeed but the mount point is not accessible.');
  }

  console.log('Drive mounted successfully.');
}

if (!existsSync(FOLDER2)) {
  abort(`Documents folder not found on the drive: ${FOLDER2}`);
}

console.log(`Launching Meld:\n  ${FOLDER1}\n  ${FOLDER2}`);

const meld = spawn('meld', [FOLDER1, FOLDER2], {
  stdio: 'ignore',
  detached: true,
});
meld.unref();
