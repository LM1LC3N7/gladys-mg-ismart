// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, command results and
// errors, feature, charge and climate names), in English and French.
// -----------------------------------------------------------------------------

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts[language] ?? texts.en;

const both = (en, fr) => ({ en, fr });

/** Feature names, in the language chosen in the configuration. */
export const FEATURE_NAMES = {
  'battery-level': both('Battery', 'Batterie'),
  range: both('Range', 'Autonomie'),
  'charge-status': both('Charge status', 'État de charge'),
  charging: both('Charging', 'En charge'),
  plugged: both('Plugged in', 'Branchée'),
  'charge-power': both('Charging power', 'Puissance de charge'),
  odometer: both('Odometer', 'Kilométrage'),
  'lock-state': both('Locks', 'Verrouillage'),
  'door-driver': both('Driver door', 'Porte conducteur'),
  'door-passenger': both('Passenger door', 'Porte passager'),
  'door-rear-left': both('Rear left door', 'Porte arrière gauche'),
  'door-rear-right': both('Rear right door', 'Porte arrière droite'),
  boot: both('Boot', 'Coffre'),
  latitude: both('Latitude', 'Latitude'),
  longitude: both('Longitude', 'Longitude'),
  'indoor-temperature': both('Cabin temperature', 'Température intérieure'),
  'climate-on': both('Climate running', 'Climatisation en marche'),
  'climate-status': both('Climate', 'Climatisation'),
  'last-update': both('Last report of the car', 'Dernier relevé de la voiture'),
  'command-status': both('Last command', 'Dernière commande'),
  refresh: both('Refresh now', 'Actualiser maintenant'),
  lock: both('Lock', 'Verrouiller'),
  unlock: both('Unlock', 'Déverrouiller'),
  'open-boot': both('Open the boot', 'Ouvrir le coffre'),
  'climate-start': both('Start the climate', 'Démarrer la climatisation'),
  'climate-stop': both('Stop the climate', 'Arrêter la climatisation'),
  'charge-start': both('Start charging', 'Démarrer la charge'),
  'charge-stop': both('Stop charging', 'Arrêter la charge'),
};

export const CHARGE_NAMES = {
  unplugged: both('Unplugged', 'Débranchée'),
  charging: both('Charging', 'En charge'),
  done: both('Charge complete', 'Charge terminée'),
  fault: both('Charging fault', 'Défaut de charge'),
  connecting: both('Connecting', 'Connexion'),
  plugged: both('Plugged in, not charging', 'Branchée, sans charge'),
  stopped: both('Charging stopped', 'Charge arrêtée'),
  scheduled: both('Scheduled charge', 'Charge programmée'),
  discharging: both('Discharging (V2L)', 'Décharge (V2L)'),
  unknown: both('Unknown', 'Inconnu'),
};

export const CLIMATE_NAMES = {
  off: both('Off', 'Arrêtée'),
  fan: both('Fan only', 'Ventilation'),
  on: both('On', 'En marche'),
  defrost: both('Front defrost', 'Dégivrage avant'),
};

/** The command names, as the command results start. */
export const COMMAND_NAMES = {
  refresh: both('Refresh', 'Actualisation'),
  lock: both('Lock', 'Verrouillage'),
  unlock: both('Unlock', 'Déverrouillage'),
  'open-boot': both('Boot unlock', 'Déverrouillage du coffre'),
  'climate-start': both('Climate start', 'Démarrage de la climatisation'),
  'climate-stop': both('Climate stop', 'Arrêt de la climatisation'),
  'charge-start': both('Charge start', 'Démarrage de la charge'),
  'charge-stop': both('Charge stop', 'Arrêt de la charge'),
};

/** Why a command had nothing to do, from the state just read. */
export const ALREADY = {
  lock: both('already locked', 'déjà verrouillée'),
  unlock: both('already unlocked', 'déjà déverrouillée'),
  'open-boot': both('the boot is already open', 'coffre déjà ouvert'),
  'climate-start': both('the climate is already on', 'climatisation déjà en marche'),
  'climate-stop': both('the climate is already off', 'climatisation déjà arrêtée'),
  'charge-start': both('already charging', 'déjà en charge'),
  'charge-stop': both('not charging', 'pas en charge'),
};

/** The configuration option a button needs, by its key in the config. */
export const OPTION_NAMES = {
  allowLock: both('Allow locking', 'Autoriser le verrouillage'),
  allowUnlock: both('Allow unlocking', 'Autoriser le déverrouillage'),
  allowTailgate: both('Allow opening the boot', "Autoriser l'ouverture du coffre"),
  allowClimate: both('Allow the climate commands', 'Autoriser les commandes de climatisation'),
  allowCharging: both('Allow the charging commands', 'Autoriser les commandes de charge'),
};

/** "25 min" / "3 h", for the pauses. */
export function age(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 120) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const T = {
  noCredentials: both(
    'Enter the e-mail and the password of your MG iSMART account (preferably a second account shared with the car).',
    "Saisissez l'e-mail et le mot de passe de votre compte MG iSMART (de préférence un compte secondaire partagé avec la voiture).",
  ),
  connecting: both('Signing in to MG iSMART…', 'Connexion à MG iSMART…'),
  connected: (count) =>
    both(
      `Connected to MG iSMART (${plural(count, 'vehicle', 'vehicles')}). Open Discovery to add them.`,
      `Connecté à MG iSMART (${plural(count, 'véhicule', 'véhicules')}). Ouvrez Découverte pour les ajouter.`,
    ),
  noVehicle: both(
    'Connected to MG iSMART, but the account has no vehicle.',
    "Connecté à MG iSMART, mais le compte n'a aucun véhicule.",
  ),
  refused: (code, wait) =>
    both(
      `MG iSMART refused the e-mail or the password (${code}): check them in the configuration. One new try in ${wait.en}, or save corrected credentials, or click "Test the connection".`,
      `MG iSMART a refusé l'e-mail ou le mot de passe (${code}) : vérifiez-les dans la configuration. Nouvel essai dans ${wait.fr}, ou enregistrez des identifiants corrigés, ou cliquez sur « Tester la connexion ».`,
    ),
  sessionTaken: (wait) =>
    both(
      `The MG session was taken again by another sign-in (the MG app?). SAIC allows one session per account: the integration paused so as not to sign the app out in a loop. New try in ${wait.en}, or click "Test the connection". A second account for Gladys avoids this.`,
      `La session MG a de nouveau été prise par une autre connexion (l'application MG ?). SAIC n'accepte qu'une session par compte : l'intégration est en pause pour ne pas déconnecter l'application en boucle. Nouvel essai dans ${wait.fr}, ou cliquez sur « Tester la connexion ». Un compte secondaire pour Gladys évite cela.`,
    ),
  busy: both(
    'MG iSMART is being read: try again in a minute.',
    'Une lecture de MG iSMART est en cours : réessayez dans une minute.',
  ),
  unreachable: (reason, wait) =>
    both(
      `MG iSMART cannot be reached (${reason}). Next try in ${wait.en}.`,
      `MG iSMART est injoignable (${reason}). Nouvel essai dans ${wait.fr}.`,
    ),
  rateLimited: (wait) =>
    both(
      `MG iSMART asks to slow down: pausing for ${wait.en}.`,
      `MG iSMART demande de ralentir : pause de ${wait.fr}.`,
    ),
  test: {
    cooldown: both(
      'Already tested less than 30 seconds ago.',
      'Déjà testé il y a moins de 30 secondes.',
    ),
    summary: (names) =>
      both(
        `Connected to MG iSMART: ${names.join(', ')}. The cars were not woken up: use their "Refresh now" button for a read.`,
        `Connecté à MG iSMART : ${names.join(', ')}. Les voitures n'ont pas été réveillées : utilisez leur bouton « Actualiser maintenant » pour une lecture.`,
      ),
  },
};

/** The text of the "Last command" feature (one language, the one of the configuration). */
export const RESULTS = {
  reading: (name) =>
    both(`${name.en}: reading the car first…`, `${name.fr} : relecture de la voiture…`),
  done: (name, time) =>
    both(
      `${name.en} sent, confirmed by MG (${time}).`,
      `${name.fr} envoyé, confirmé par MG (${time}).`,
    ),
  unconfirmed: (name, reason, time) =>
    both(
      `${name.en} sent, not confirmed (${reason}, ${time}): check the state before trying again.`,
      `${name.fr} envoyé, sans confirmation (${reason}, ${time}) : vérifiez l'état avant de réessayer.`,
    ),
  refusedByMg: (name, reason, time) =>
    both(
      `${name.en} refused by MG (${reason}, ${time}).`,
      `${name.fr} refusé par MG (${reason}, ${time}).`,
    ),
  notSent: (name, why, time) =>
    both(
      `${name.en} not sent: ${why.en} (${time}).`,
      `${name.fr} non envoyé : ${why.fr} (${time}).`,
    ),
  refreshed: (time) => both(`Refreshed (${time}).`, `Actualisé (${time}).`),
  refreshFailed: (reason, time) =>
    both(`Refresh failed (${reason}, ${time}).`, `Actualisation impossible (${reason}, ${time}).`),
  carFailure: (name, failure, time) =>
    both(
      `${name.en} sent, the car reported a failure (${failure}, ${time}): check the state.`,
      `${name.fr} envoyé, échec signalé par la voiture (${failure}, ${time}) : vérifiez l'état.`,
    ),
  notConfirmed: (name, time) =>
    both(
      `${name.en} sent, state not confirmed (${time}): check it before trying again.`,
      `${name.fr} envoyé, état non confirmé (${time}) : vérifiez-le avant de réessayer.`,
    ),
  interrupted: both(
    'Last command interrupted (restart): check the state of the car.',
    "Dernière commande interrompue (redémarrage) : vérifiez l'état de la voiture.",
  ),
};

/** Why a command was not sent, after the read. */
export const WHY = {
  unknownState: both('the state of the car is unknown', "l'état de la voiture est inconnu"),
  notPlugged: both('the car is not plugged in', "la voiture n'est pas branchée"),
  readFailed: (reason) =>
    both(`the car could not be read (${reason})`, `la voiture n'a pas pu être relue (${reason})`),
  disabled: both('the option was turned off', "l'option a été désactivée"),
  notConnected: both('not connected to MG iSMART', 'pas connecté à MG iSMART'),
  stale: (time) => both(`stale state (report of ${time})`, `état périmé (relevé de ${time})`),
};

/** Errors of a button press (Gladys shows the message as is). */
export const ERRORS = {
  readOnly: both('This feature is read only.', 'Cette fonctionnalité est en lecture seule.'),
  disabled: (option) =>
    both(
      `This command is disabled: turn on "${option.en}" in the configuration of the integration.`,
      `Cette commande est désactivée : activez « ${option.fr} » dans la configuration de l'intégration.`,
    ),
  notConnected: both('Not connected to MG iSMART.', 'Pas connecté à MG iSMART.'),
  invalidValue: both(
    'Invalid value: only a press (1) is accepted.',
    'Valeur invalide : seul un appui (1) est accepté.',
  ),
  stillRunning: both(
    'A command or a read of this car is still running: try again in a minute.',
    'Une commande ou une lecture de cette voiture est encore en cours : réessayez dans une minute.',
  ),
  tooSoon: (wait) =>
    both(
      `This car was woken up by a click less than 2 minutes ago: each press reads the car and wakes it (12 V battery). Try again in ${wait.en}.`,
      `Cette voiture a été réveillée par un clic il y a moins de 2 minutes : chaque appui relit la voiture et la réveille (batterie 12 V). Réessayez dans ${wait.fr}.`,
    ),
  tooMany: (wait) =>
    both(
      `6 wake-ups of this car in the last hour already (refresh and commands): to spare its 12 V battery, try again in ${wait.en}.`,
      `Déjà 6 réveils de cette voiture dans l'heure (actualisations et commandes) : pour ménager sa batterie 12 V, réessayez dans ${wait.fr}.`,
    ),
  asleep: (time) =>
    both(
      `The car did not answer its last read: it is left asleep until ${time} (12 V battery).`,
      `La voiture n'a pas répondu à sa dernière lecture : elle est laissée endormie jusqu'à ${time} (batterie 12 V).`,
    ),
  unknownVehicle: both('Unknown vehicle.', 'Véhicule inconnu.'),
};
