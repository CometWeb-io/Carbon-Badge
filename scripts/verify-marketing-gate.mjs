import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Bind successful installation tests to the exact package and approved target. */
export function verifyMarketingReceipt(receipt, manifest, origin, now = Date.now()) {
    const target = new URL(origin);
    if (target.protocol !== 'https:' || target.origin !== origin) throw Error('Marketing release origin must be an HTTPS origin');
    const testedAt = Date.parse(receipt.testedAt);
    if (receipt.schema !== 1 || receipt.origin !== origin || receipt.version !== manifest.version ||
        receipt.gitSha !== manifest.gitSha || receipt.esmSha256 !== manifest.esm.sha256 ||
        receipt.sourceDirty !== false || manifest.sourceDirty !== false ||
        !Number.isFinite(testedAt) || testedAt > now || now - testedAt > 7 * 86400_000) {
        throw Error('Missing, stale or mismatched marketing release evidence');
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const receipt = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const manifest = JSON.parse(await readFile('dist/release-manifest.json', 'utf8'));
    verifyMarketingReceipt(receipt, manifest, process.env.BADGE_MARKETING_ORIGIN);
    console.log('Exact package marketing integration gate passed');
}
