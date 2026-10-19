// Only reviewed, subject-specific photographs may be selected here.
export const subjectImages = {
  'technology/lenses/prime-lenses': {
    subject: 'Auto Revuenon 50 mm f/1.8 fixed-focal-length photographic lens',
    url: '/photos/prime-lens.jpg',
    source_page: 'https://commons.wikimedia.org/wiki/File:Revuenon_Auto_50mm_prime_lens.jpg',
    original_url: 'https://upload.wikimedia.org/wikipedia/commons/8/8a/Revuenon_Auto_50mm_prime_lens.jpg',
    creator: 'Flanoz', license: 'CC0 1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    caption: 'Auto Revuenon 50 mm f/1.8: a photographic prime lens illustrating fixed focal length, not a claimed cinema-lens model. Photograph: Flanoz.',
    evidence: 'File description identifies a 50 mm prime; the inspected photograph shows Auto Revuenon and 1:1.8 f=50mm markings.',
    width: 4000, height: 3000, review_status: 'APPROVED', health_status: 'HEALTHY', retrieved_at: '2026-10-19', display_mode: 'local', changes: 'None'
  },
  'technology/lenses/macro-lenses': {
    subject: 'Vivitar Series 1 90 mm f/2.5 macro lens with macro adapter',
    url: '/photos/macro-lens.jpg',
    source_page: 'https://commons.wikimedia.org/wiki/File:Macro_Lens_Vivitar_90mm.jpg',
    original_url: 'https://upload.wikimedia.org/wikipedia/commons/e/e7/Macro_Lens_Vivitar_90mm.jpg',
    creator: 'Helmut Schütz', license: 'CC BY-SA 2.5', license_url: 'https://creativecommons.org/licenses/by-sa/2.5/',
    caption: 'Vivitar Series 1 90 mm f/2.5 photographic macro lens and adapter. An example of close-focus optics, not a claimed cinema-lens model. Photograph: Helmut Schütz.',
    evidence: 'File description names the exact macro lens; inspected photograph shows Vivitar Series 1 and macro-adapter markings.',
    width: 1400, height: 933, review_status: 'APPROVED', health_status: 'HEALTHY', retrieved_at: '2026-10-19', display_mode: 'local', changes: 'None'
  },
  'technology/film/16-mm-film': {
    subject: '16 mm black-and-white sound motion-picture film',
    url: '/photos/16mm-movie-film.jpg',
    source_page: 'https://commons.wikimedia.org/wiki/File:16mm_Movie_Film.jpg',
    original_url: 'https://upload.wikimedia.org/wikipedia/commons/6/69/16mm_Movie_Film.jpg',
    creator: 'Runner1616', license: 'CC BY-SA 3.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/3.0/',
    caption: '16 mm black-and-white sound film, photographed by Runner1616. Example of the gauge; this does not identify its film-base chemistry.',
    evidence: 'File description identifies 16 mm sound film; photograph visibly shows single-edge perforations and an optical soundtrack.',
    width: 2880, height: 3198,
    review_status: 'APPROVED', health_status: 'HEALTHY',
    retrieved_at: '2026-10-19', display_mode: 'local', changes: 'None'
  }
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function approvedSubjectImage(key, registry = subjectImages) {
  const image = registry[key];
  if (!image || image.review_status !== 'APPROVED' || image.health_status !== 'HEALTHY') return null;
  if (!image.evidence || !image.creator || !image.license || !image.license_url?.startsWith('https://') || !image.source_page?.startsWith('https://')) return null;
  if (!(image.width > 0 && image.height > 0) || !/^\/photos\/[^?#]+\.(jpg|jpeg|png|webp)$/i.test(image.url || '')) return null;
  return image;
}
export function subjectPhoto(key, label, className = '') {
  const image = approvedSubjectImage(key);
  // Explicit review state in an unpublished candidate. This is a release blocker,
  // never substitute art or a claim that the image requirement has been met.
  if (!image) return `<p class="image-review-pending" data-image-subject="${esc(key)}" data-image-status="PENDING">Authentic photograph under review: ${esc(label)}</p>`;
  return `<figure class="subject-photograph ${esc(className)}" data-image-subject="${esc(key)}" data-image-status="APPROVED"><img src="${esc(image.url)}" alt="${esc(image.subject)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async"><figcaption>${esc(image.caption)} <a href="${esc(image.source_page)}" target="_blank" rel="noopener noreferrer">Source</a> · <a href="${esc(image.license_url)}" target="_blank" rel="noopener noreferrer">${esc(image.license)}</a> · Changes: ${esc(image.changes)}</figcaption></figure>`;
}
