# MG iSMART pour Gladys

Affiche vos voitures **MG** (MG4, ZS EV, MG5, Marvel R, MG4 XPower…) dans
Gladys, par le cloud **SAIC iSMART** (Europe), avec le compte de
l'application MG iSMART.

> **API non officielle, jamais testée avec un vrai compte ni une vraie
> voiture.** L'intégration parle à la passerelle de l'application MG iSMART,
> comme la bibliothèque saic-ismart-client-ng. SAIC peut la changer sans
> prévenir. Sans lien avec MG ni SAIC Motor.

## Avant de commencer : un compte secondaire

**SAIC n'accepte qu'une session par compte.** Quand l'intégration se
connecte, l'application MG de votre téléphone est déconnectée, et
inversement. Le plus simple : créez un **compte secondaire** (autre e-mail)
dans l'application MG iSMART, partagez-lui la voiture depuis votre compte
principal, et donnez ce compte secondaire à Gladys.

Si vous utilisez le même compte, l'intégration se reconnecte **une seule
fois par 24 h** quand sa session est prise ; reprise de nouveau dans ces
24 h, elle se met en pause (nouvel essai après 6 h, puis toutes les 24 h)
pour ne pas déconnecter l'application en boucle.

## Ce que vous obtenez

Un appareil par voiture du compte, avec :

| Fonctionnalité               | Contenu                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Batterie                     | État de charge en %                                                                                              |
| Autonomie                    | En km                                                                                                            |
| État de charge               | Débranchée, Branchée sans charge, En charge, Charge terminée, programmée, défaut…                                |
| En charge / Branchée         | Oui ou non                                                                                                       |
| Puissance de charge          | En kW, quand la voiture charge (0 sinon)                                                                         |
| Kilométrage                  | En km                                                                                                            |
| Verrouillage                 | Verrouillée ou déverrouillée (lecture seule)                                                                     |
| Portes (4) et coffre         | Ouvert ou fermé                                                                                                  |
| Latitude, longitude          | Position de la voiture, sans historique                                                                          |
| Température intérieure       | En °C                                                                                                            |
| Climatisation (en marche)    | Oui ou non, et son mode : arrêtée, ventilation, en marche, dégivrage avant                                       |
| Dernier relevé de la voiture | Date et heure du dernier relevé envoyé par la voiture                                                            |
| Dernière commande            | Le résultat de la dernière commande ou actualisation                                                             |
| Boutons                      | Actualiser maintenant, Verrouiller, Déverrouiller, Ouvrir le coffre, climatisation et charge (démarrer, arrêter) |

**Énergie** : la passerelle ne donne aucun compteur cumulé fiable.
L'intégration ne publie donc **aucun index** ni consommation : la puissance
de charge est un simple capteur.

**Position** : publiée comme deux nombres, sans historique dans Gladys,
jamais écrite dans les journaux ni dans `/data`.

## La batterie 12 V : des lectures espacées

**Chaque lecture réveille la voiture**, qui puise alors dans sa batterie
12 V. Réveiller une voiture garée trop souvent peut vider cette batterie et
l'empêcher de démarrer. Donc :

- une lecture par voiture **toutes les 3 heures** par défaut (réglable de
  60 minutes à 24 heures), **toutes les 30 minutes en charge** (la voiture
  est alors éveillée et branchée) ;
- une voiture qui ne répond pas (30 secondes d'attente) est relue après
  l'intervalle, puis deux fois plus tard à chaque silence (jusqu'à une fois
  par jour) : jamais en boucle ;
- une erreur n'est jamais relue plus vite que l'intervalle ;
- le bouton **Actualiser maintenant** relit la voiture tout de suite, au plus
  toutes les 10 minutes ;
- la liste des véhicules (qui ne réveille pas la voiture) est relue au
  démarrage, puis toutes les 24 heures ;
- l'heure de la prochaine lecture est gardée dans `/data` : un redémarrage
  ne réveille pas la voiture avant son heure.

## Installation

1. Installez l'intégration depuis le store de Gladys.
2. Dans sa configuration, saisissez l'**e-mail** et le **mot de passe** du
   compte MG iSMART (de préférence le compte secondaire). Le mot de passe est
   gardé par Gladys dans sa base, jamais réaffiché, envoyé seulement à la
   passerelle MG iSMART de SAIC, sous forme d'empreinte SHA-1 comme le fait
   l'application.
3. Réglez au besoin l'**intervalle**, le **fuseau horaire** (Europe/Paris par
   défaut) et la **langue** des noms.
4. Enregistrez, puis ajoutez les voitures depuis l'onglet **Découverte**.

Le bouton **Tester la connexion** se connecte si besoin et lit la liste des
véhicules, **sans réveiller les voitures** (au plus toutes les 30 secondes).
Il réessaie aussi tout de suite après un arrêt.

## Commandes (toutes désactivées par défaut)

Chaque commande est un **bouton**, jamais un interrupteur : un « éteins
tout », Google Home, Alexa, HomeKit ou une action de scène « interrupteur »
ne les touchent pas. Une scène peut presser un bouton, seulement par une
action explicite sur ce bouton, et seulement si son option est activée.

| Bouton                       | Option à activer                         |
| ---------------------------- | ---------------------------------------- |
| Verrouiller                  | Autoriser le verrouillage                |
| Déverrouiller                | Autoriser le déverrouillage              |
| Ouvrir le coffre             | Autoriser l'ouverture du coffre          |
| Démarrer / arrêter la clim.  | Autoriser les commandes de climatisation |
| Démarrer / arrêter la charge | Autoriser les commandes de charge        |

Le déverrouillage et l'ouverture du coffre se font à distance, par
quiconque peut presser le bouton dans Gladys : laissez ces options
désactivées si vous n'en avez pas besoin.

Comment une commande se passe :

1. Gladys reçoit tout de suite la réponse « acceptée » (la passerelle met
   souvent plus de 10 secondes, et Gladys n'attend que 5 secondes) ;
   « Dernière commande » affiche « relecture de la voiture… ».
2. L'intégration **relit la voiture** et décide seulement sur cet état relu,
   jamais sur la mémoire : une commande inutile (déjà verrouillée, clim déjà
   en marche…) n'est pas envoyée ; un état inconnu, une voiture qui ne répond
   pas, une voiture non branchée (pour la charge) refusent la commande sans
   l'envoyer.
3. La commande part **une seule fois**, jamais renvoyée après un échec.
4. « Dernière commande » donne le résultat : envoyée et confirmée par MG,
   envoyée sans confirmation (vérifiez avant de réessayer), refusée par MG,
   ou non envoyée avec la raison. La voiture est relue environ 90 secondes
   plus tard.

Une commande à la fois par voiture. L'intégration n'envoie jamais de code
(SMS, e-mail) : la connexion se fait par e-mail et mot de passe seulement.

## Erreurs et limites

- **E-mail ou mot de passe refusé** : arrêt, un seul nouvel essai après 6 h,
  puis toutes les 24 h. Enregistrer de nouveaux identifiants ou le bouton de
  test réessaient tout de suite.
- **Session prise par l'application** : voir « un compte secondaire »
  ci-dessus.
- **429 (trop de requêtes)** : pause de 1 minute à 6 heures (15 minutes sans
  indication), pour tout (lectures, boutons, commandes), gardée après un
  redémarrage.
- **Réseau, 5xx** : nouvel essai après l'intervalle, jamais plus tôt.
- `/data` garde le jeton de session MG, en clair, dans un fichier réservé à
  l'utilisateur du conteneur (0600), donc lisible aussi par l'administrateur
  de la machine et dans les sauvegardes du volume ; jamais l'e-mail, le mot
  de passe, le VIN ni la position. Ce jeton donne accès à la voiture : il
  disparaît quand l'intégration est supprimée.
- Seules les voitures européennes (passerelle `gateway-mg-eu`) et la
  connexion par e-mail sont prises en charge (pas encore par téléphone).
- Non pris en charge pour l'instant : température de consigne, sièges et
  volant chauffants, vitres, toit, recherche de la voiture, cible de charge,
  charge programmée, verrou de la prise, alarmes.
- Les journaux ne contiennent jamais le mot de passe, le jeton, le VIN, la
  position, ni le texte des réponses de la passerelle.

## Crédits

Portage de [saic-ismart-client-ng](https://github.com/SAIC-iSmart-API/saic-python-client-ng)
(SAIC-iSmart-API, MIT, version 0.10.0). Licence Apache-2.0.
