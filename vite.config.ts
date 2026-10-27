import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: !process.env.FWALLSIM_E2E,
    // Test, course and video output change (and get locked on Windows) while tests run; watching them crashes the server.
    watch: { ignored: ['**/e2e-results/**', '**/playwright-report/**', '**/course/out/**', '**/course/img/**', '**/course/pdf/**', '**/video/**', '**/dist/**'] },
  },
});
