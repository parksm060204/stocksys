import * as dotenv from 'dotenv';

dotenv.config();

export class NewsFetcher {
  public start() {
    console.log("📰 News Fetcher is disabled.");
  }

  public stop() {
    console.log("🛑 News Fetcher Stopped.");
  }
}
