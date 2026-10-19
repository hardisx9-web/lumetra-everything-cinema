import { filmTitle, filmMetadata, viewingStatus } from './artwork-ui.js';

// These are catalogue encounters, not claims that a randomly selected film
// belongs to a particular movement or illustrates a prewritten historical essay.
export function createCinemaHistoryChapters(films = []) {
  return films.map((film) => ({
    kicker: `${film.year || 'DATE UNRESOLVED'} / FROM THE CATALOGUE`,
    title: filmTitle(film),
    text: `${filmMetadata(film)}. ${viewingStatus(film)}. Follow the dossier for recorded evidence and viewing details.`,
    film,
    id: film.id,
  }));
}
