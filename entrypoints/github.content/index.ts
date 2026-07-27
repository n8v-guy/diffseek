import { startReviewApp } from '@diffseek/app/review/review-app';
import './style.css';

export default defineContentScript({
  matches: ['https://github.com/*'],
  async main(ctx) {
    const app = await startReviewApp();
    ctx.onInvalidated(app.stop);
  },
});
