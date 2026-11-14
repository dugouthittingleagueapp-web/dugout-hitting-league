import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { FileDropzone } from '../../components/FileDropzone';
import {
  handleDragOverEvent,
  handleDragEnterEvent,
  handleDragLeaveEvent,
  handleDropEvent,
  isDropzoneActivationKey,
} from '../../utils/dropzoneHelper';

describe('FileDropzone Drag-and-Drop and Compatibility', () => {
  describe('Component Rendering & Accessibility', () => {
    it('renders with role="button", tabIndex=0, and accessible aria-label', () => {
      const html = renderToString(
        React.createElement(FileDropzone, {
          onFileSelect: vi.fn(),
          title: 'Drag & Drop Schedule CSV',
          subtitle: 'Supported format',
          selectedFileName: 'test_schedule.csv',
        })
      );

      expect(html).toContain('role="button"');
      expect(html).toContain('tabindex="0"');
      expect(html).toContain('aria-label="Drag &amp; Drop Schedule CSV"');
      expect(html).toContain('Drag &amp; Drop Schedule CSV');
      expect(html).toContain('Supported format');
      expect(html).toContain('test_schedule.csv');
      expect(html).toContain('type="file"');
    });

    it('sets aria-disabled and disabled styles when disabled=true', () => {
      const html = renderToString(
        React.createElement(FileDropzone, {
          onFileSelect: vi.fn(),
          disabled: true,
          title: 'Disabled Dropzone',
        })
      );

      expect(html).toContain('aria-disabled="true"');
      expect(html).toContain('cursor-not-allowed');
      expect(html).toContain('opacity-50');
    });
  });

  describe('Drag & Drop Event Handlers', () => {
    it('onDragOver: prevents browser default and propagation, sets dropEffect="copy"', () => {
      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {
          dropEffect: 'none',
        },
      };

      const setIsDragging = vi.fn();
      handleDragOverEvent(mockEvent, { isDragging: false, setIsDragging });

      expect(mockEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(mockEvent.stopPropagation).toHaveBeenCalledTimes(1);
      expect(mockEvent.dataTransfer.dropEffect).toBe('copy');
      expect(setIsDragging).toHaveBeenCalledWith(true);
    });

    it('onDragEnter: increments depth counter and enables active dragging state', () => {
      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {
          items: [{ kind: 'file' }],
        },
      };

      const counterRef = { current: 0 };
      const setIsDragging = vi.fn();

      handleDragEnterEvent(mockEvent, counterRef, setIsDragging);

      expect(mockEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(mockEvent.stopPropagation).toHaveBeenCalledTimes(1);
      expect(counterRef.current).toBe(1);
      expect(setIsDragging).toHaveBeenCalledWith(true);
    });

    it('shows drag feedback when DataTransfer.items is unavailable until drop', () => {
      const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), dataTransfer: { files: [] } };
      const depth = { current: 0 };
      const active = vi.fn();
      handleDragEnterEvent(event, depth, active, false);
      expect(active).toHaveBeenCalledWith(true);
      expect(depth.current).toBe(1);
    });

    it('onDragLeave: decrements depth counter and clears active dragging state on exit', () => {
      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };

      const counterRef = { current: 1 };
      const setIsDragging = vi.fn();

      handleDragLeaveEvent(mockEvent, counterRef, setIsDragging);

      expect(mockEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(mockEvent.stopPropagation).toHaveBeenCalledTimes(1);
      expect(counterRef.current).toBe(0);
      expect(setIsDragging).toHaveBeenCalledWith(false);
    });

    it('onDrop: extracts dropped file, prevents browser navigation, and calls onFileSelect', () => {
      const fakeFile = {
        name: 'schedule_2026.csv',
        size: 2048,
        type: 'text/csv',
      } as unknown as File;

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {
          files: [fakeFile],
        },
      };

      const counterRef = { current: 2 };
      const setIsDragging = vi.fn();
      const onFileSelect = vi.fn();

      handleDropEvent(mockEvent, counterRef, setIsDragging, onFileSelect, false);

      expect(mockEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(mockEvent.stopPropagation).toHaveBeenCalledTimes(1);
      expect(counterRef.current).toBe(0);
      expect(setIsDragging).toHaveBeenCalledWith(false);
      expect(onFileSelect).toHaveBeenCalledTimes(1);
      expect(onFileSelect).toHaveBeenCalledWith(fakeFile);
    });

    it('onDrop: does nothing if dropzone is disabled', () => {
      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {
          files: [{ name: 'file.csv' } as File],
        },
      };

      const counterRef = { current: 1 };
      const setIsDragging = vi.fn();
      const onFileSelect = vi.fn();

      handleDropEvent(mockEvent, counterRef, setIsDragging, onFileSelect, true);

      expect(mockEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(mockEvent.stopPropagation).toHaveBeenCalledTimes(1);
      expect(onFileSelect).not.toHaveBeenCalled();
    });
  });

  describe('Keyboard & Cross-Device Activation', () => {
    it('accepts Enter and Space as activation keys for accessible keyboard opening', () => {
      expect(isDropzoneActivationKey('Enter')).toBe(true);
      expect(isDropzoneActivationKey(' ')).toBe(true);
      expect(isDropzoneActivationKey('Escape')).toBe(false);
      expect(isDropzoneActivationKey('Tab')).toBe(false);
    });
  });
});
