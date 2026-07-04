import { stripCogmemRecallBlocks } from './ContextHygiene.js';
export function serializeUntrustedMemory(input, limit = 500) {
    const clean = stripCogmemRecallBlocks(String(input ?? '')).text
        .replace(/<\/?COGMEM_[A-Z0-9_:-]+[^>]*>/gi, '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    return clean.slice(0, Math.max(0, limit));
}
