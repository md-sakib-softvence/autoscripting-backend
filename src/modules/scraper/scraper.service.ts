import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import * as archiver from 'archiver';
import axios from 'axios';
import { Response } from 'express';

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  async scrape(url: string) {
    this.logger.log(`🔍 Scraping URL: ${url}`);

    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    try {
      const page = await browser.newPage();

      // Set realistic User-Agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Set extra headers
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
      });

      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(url, { waitUntil: 'networkidle2' });

      // Auto-scroll to trigger lazy loading
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let totalHeight = 0;
          const distance = 100;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;

            if (totalHeight >= scrollHeight || totalHeight > 5000) { // Limit to 5k pixels or end
              clearInterval(timer);
              resolve(true);
            }
          }, 100);
        });
      });

      // Extract Images (Improved)
      const images = await page.evaluate(() => {
        const results = new Set<string>();

        // Check all images
        document.querySelectorAll('img').forEach((img) => {
          if (img.src && img.src.startsWith('http')) results.add(img.src);

          // Handle srcset (pick the last one usually highest quality)
          if (img.srcset) {
            const sources = img.srcset.split(',').map(s => s.trim().split(' ')[0]);
            sources.forEach(src => {
              if (src.startsWith('http')) results.add(src);
              else if (src.startsWith('/')) results.add(window.location.origin + src);
            });
          }

          // Handle data-src or data-original (lazy loading)
          ['data-src', 'data-original', 'data-lazy'].forEach(attr => {
            const val = img.getAttribute(attr);
            if (val && val.startsWith('http')) results.add(val);
          });
        });

        // Check picture tags
        document.querySelectorAll('picture source').forEach((source: any) => {
          if (source.srcset) {
            const sources = source.srcset.split(',').map(s => s.trim().split(' ')[0]);
            sources.forEach(src => {
              if (src.startsWith('http')) results.add(src);
            });
          }
        });

        return Array.from(results);
      });

      // Extract Links
      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a'))
          .map((a) => ({ text: a.innerText.trim(), href: a.href }))
          .filter((link) => link.href && link.href.startsWith('http'));
      });

      // Extract Videos (Improved)
      const videos = await page.evaluate(() => {
        const results = new Set<string>();

        document.querySelectorAll('video').forEach(v => {
          if (v.src) results.add(v.src);
          v.querySelectorAll('source').forEach(s => {
            if (s.src) results.add(s.src);
          });
        });

        document.querySelectorAll('iframe').forEach(iframe => {
          if (iframe.src && (iframe.src.includes('youtube.com') || iframe.src.includes('vimeo.com') || iframe.src.includes('video'))) {
            results.add(iframe.src);
          }
        });

        return Array.from(results);
      });

      // Extract H1 Tags
      const h1s = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('h1'))
          .map((h1) => h1.innerText.trim())
          .filter((text) => text.length > 0);
      });

      return {
        images,
        links,
        videos,
        h1s,
      };
    } catch (error) {
      this.logger.error(`❌ Failed to scrape ${url}: ${error.message}`);
      throw error;
    } finally {
      await browser.close();
    }
  }

  async createZip(urls: string[], res: Response) {
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
      this.logger.error(`Archive error: ${err.message}`);
      res.status(500).send({ error: 'Failed to create archive' });
    });

    res.attachment('scraped-media.zip');
    archive.pipe(res);

    for (const [index, url] of urls.entries()) {
      try {
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
        const extension = url.split('.').pop().split(/\#|\?/)[0] || 'jpg';
        archive.append(Buffer.from(response.data), { name: `media-${index}.${extension}` });
      } catch (error) {
        this.logger.error(`Failed to download ${url}: ${error.message}`);
      }
    }

    await archive.finalize();
  }
}
