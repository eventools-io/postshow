import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        URLSearchParams: 'readonly',
        HTMLFormElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLOptionElement: 'readonly',
        HTMLSelectElement: 'readonly',
        // Browser storage APIs
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        Storage: 'readonly',
        // Browser crypto API
        crypto: 'readonly',
        // Browser dialog API
        confirm: 'readonly',
        alert: 'readonly',
        prompt: 'readonly',
        // Test globals
        vi: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        // Deno runtime (for Edge Functions)
        Deno: 'readonly',
        // TextEncoder/TextDecoder
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        // DOM Events
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        PointerEvent: 'readonly',
        Event: 'readonly',
        MessageEvent: 'readonly',
        // DOM Elements
        Element: 'readonly',
        HTMLElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLLIElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLUListElement: 'readonly',
        HTMLImageElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        SVGElement: 'readonly',
        SVGSVGElement: 'readonly',
        SVGGElement: 'readonly',
        Node: 'readonly',
        // Canvas / image APIs
        CanvasRenderingContext2D: 'readonly',
        ImageBitmap: 'readonly',
        createImageBitmap: 'readonly',
        BlobCallback: 'readonly',
        // Browser APIs
        XMLSerializer: 'readonly',
        Image: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        ClipboardItem: 'readonly',
        BroadcastChannel: 'readonly',
        DOMRect: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        RequestInfo: 'readonly',
        RequestInit: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        FrameRequestCallback: 'readonly',
        // File APIs
        File: 'readonly',
        FileReader: 'readonly',
        FileList: 'readonly',
        // Media APIs
        MediaRecorder: 'readonly',
        MediaStream: 'readonly',
        MediaDeviceInfo: 'readonly',
        MediaRecorderOptions: 'readonly',
        MediaTrackConstraints: 'readonly',
        MediaTrackConstraintSet: 'readonly',
        HTMLVideoElement: 'readonly',
        DOMException: 'readonly',
        // Audio APIs
        AudioContext: 'readonly',
        ScriptProcessorNode: 'readonly',
        AnalyserNode: 'readonly',
        AudioWorkletNode: 'readonly',
        AudioBufferSourceNode: 'readonly',
        MediaStreamAudioSourceNode: 'readonly',
        // WebSocket API
        WebSocket: 'readonly',
        // DOM APIs
        getComputedStyle: 'readonly',
        ResizeObserver: 'readonly',
        // Node.js types
        NodeJS: 'readonly',
        // React/JSX
        JSX: 'readonly',
        React: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...typescript.configs['recommended'].rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  prettier,
];
