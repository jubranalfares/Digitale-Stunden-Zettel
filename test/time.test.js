import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  InputError, computeWorkMinutes, formatDuration, isValidISODate, parseClock, parseDuration, shiftMonth,
} from '../src/time.js';

test('Uhrzeiten werden gelesen', () => {
  assert.equal(parseClock('10:00'), 600);
  assert.equal(parseClock('7.30'), 450);
  assert.equal(parseClock('9'), 540);
  assert.equal(parseClock('930'), 570);
  assert.equal(parseClock('1230'), 750);
  assert.equal(parseClock(''), null);
  assert.throws(() => parseClock('25:00'), InputError);
  assert.throws(() => parseClock('abc'), InputError);
});

test('Pausen in verschiedenen Schreibweisen', () => {
  assert.equal(parseDuration('0:30'), 30);
  assert.equal(parseDuration('45'), 45);
  assert.equal(parseDuration('1'), 60);
  assert.equal(parseDuration('130'), 90);
  assert.equal(parseDuration('1,5'), 90);
  assert.equal(parseDuration(''), 0);
  assert.throws(() => parseDuration('x'), InputError);
});

test('Arbeitszeit inkl. Schicht über Mitternacht', () => {
  assert.equal(computeWorkMinutes(600, 1080, 30), 450);
  assert.equal(computeWorkMinutes(1260, 60, 0), 240);
  assert.throws(() => computeWorkMinutes(600, 600, 0), InputError);
  assert.throws(() => computeWorkMinutes(600, 630, 30), InputError);
  assert.equal(formatDuration(450), '7:30');
});

test('Datum und Monate', () => {
  assert.ok(isValidISODate('2028-02-29'));
  assert.ok(!isValidISODate('2026-02-29'));
  assert.deepEqual(shiftMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
});
