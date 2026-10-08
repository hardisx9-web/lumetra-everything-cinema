// Individually reviewed Commons files. Remote image URLs are NOT permission to reuse other provider artwork.
// The depicted still/poster remains credited to its original filmmaker/studio. Review reuse by territory.
// Wikimedia Commons file pages were checked 2026-10-08; all four list public-domain status.
const commons = (filename) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename).replace(/%2F/g, '/')}`;
const description = (filename) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(filename).replace(/%2F/g, '/')}`;
const item = (filename, label) => ({ url: commons(filename), verified: true, usage: 'PUBLIC_DOMAIN',
  licence: 'Public domain (Commons file description; jurisdiction may vary)',
  credit: label, sourcePage: description(filename) });
export const curatedArtwork = Object.freeze({
  'work-trip-to-the-moon': item('Trip-to-moon-1902.jpg', 'Georges Méliès · A Trip to the Moon (1902) · historical poster'),
  'work-man-with-a-movie-camera': item('Man with a movie camera 1929 1.png', 'Dziga Vertov · Man with a Movie Camera (1929) · film still'),
  'work-cleopatra-1917': item('Cleopatra1917.jpg', 'Fox Film Corporation · Cleopatra (1917) · original poster'),
  'work-london-after-midnight': item('London After Midnight Poster 1927 MGM.jpg', 'MGM · London After Midnight (1927) · historical poster'),
});
export function artworkFor(film) {
  const file = film?.poster?.verified && ['LICENSED','PUBLIC_DOMAIN'].includes(film?.poster?.usage) ? film.poster : curatedArtwork[film?.id];
  return file?.url && /^https:\/\//i.test(file.url) ? file : null;
}
