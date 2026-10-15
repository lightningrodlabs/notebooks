import { describe, it, expect } from 'vitest';
import { placeAddButton } from './add-button';

const container = { left: 100, top: 50, width: 400 };

describe('placeAddButton', () => {
  it('floats above the selection when there is room', () => {
    expect(placeAddButton({ left: 150, top: 200, bottom: 216 }, container, 0, 0)).toEqual({ left: 50, top: 116 });
  });
  it('drops below the selection on the first line', () => {
    expect(placeAddButton({ left: 150, top: 54, bottom: 70 }, container, 0, 0)).toEqual({ left: 50, top: 24 });
  });
  it('stays inside the right edge', () => {
    expect(placeAddButton({ left: 495, top: 200, bottom: 216 }, container, 0, 0).left).toBe(360);
  });
  it('follows the container\'s own scroll offset', () => {
    expect(placeAddButton({ left: 150, top: 200, bottom: 216 }, container, 300, 10)).toEqual({ left: 60, top: 416 });
  });
});
