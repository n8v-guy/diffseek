import { defineContentScript } from 'wxt/utils/define-content-script';

import { startReviewApp } from '@diffseek/app/review/review-app';
import './style.css';

export default defineContentScript({
  async main(ctx) {
    const app = await startReviewApp();
    ctx.onInvalidated(app.stop);
  },
  matches: ['https://github.com/*'],
});
