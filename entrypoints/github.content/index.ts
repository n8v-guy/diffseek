import { startReviewApp } from '@diffseek/app/review/review-app';
import { defineContentScript } from 'wxt/utils/define-content-script';

import './style.css';

export default defineContentScript({
  async main(ctx) {
    const app = await startReviewApp();
    ctx.onInvalidated(app.stop);
  },
  matches: ['https://github.com/*'],
});
