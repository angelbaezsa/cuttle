module.exports = function (req, res) {
  const promiseGame = gameService.findGame({gameId: req.session.game});
  const promisePlayer = userService.findUser({userId: req.session.usr});
  const promiseOpponent = userService.findUser({userId: req.body.opId});
  const promiseCard = cardService.findCard({cardId: req.body.cardId});
  const promiseTarget = cardService.findCard({cardId: req.body.targetId});
  const targetType = req.body.targetType;
  let promisePoint = null;
  if (targetType === 'jack') {
    promisePoint = cardService.findCard({cardId: req.body.pointId});
  } else {
    promisePoint = Promise.resolve(null);
  }
  Promise.all([promiseGame, promisePlayer, promiseOpponent, promiseCard, promiseTarget, targetType, promisePoint])
    .then(function changeAndSave(values) {
      const [game, player, opponent, card, target, targetType, point] = values;
      if (player.pNum === game.turn % 2) {
        if (!game.oneOff) {
          if (card.hand === player.id) {
            if (card.rank === 2 || card.rank === 9) {
              const queenCount = userService.queenCount({user: opponent});
              switch (queenCount) {
                case 0:
                  break;
                case 1:
                  if (target.faceCards === opponent.id && target.rank === 12) {
                  } else {
                    return Promise.reject({message: "Your opponent's queen prevents you from targeting their other cards"});
                  }
                  break;
                default:
                  return Promise.reject({message: "You cannot play a Targeted One-Off (Two, Nine) when your opponent has more than one Queen"});
              }
              if (player.frozenId !== card.id) {
                // Move is valid -- make changes
                const gameUpdates = {
                  oneOff: card.id,
                  oneOffTarget: target.id,
                  oneOffTargetType: targetType,
                  attachedToTarget: null,
                  log: [
                    ...game.log,
                    `${player.username} played the ${card.name} as a one-off to: ${card.ruleText}, targeting the ${target.name}.`,
                  ],
                  lastEvent: {
                    change: 'targetedOneOff',
                    pNum: req.session.pNum,
                  },
                };
                if (point) gameUpdates.attachedToTarget = point.id;

                const updatePromises = [
                  Game.updateOne(game.id)
                    .set(gameUpdates),
                  // Remove one-off from player's hand
                  User.removeFromCollection(player.id, 'hand')
                    .members([card.id]),
                ];
                return Promise.all([game, ...updatePromises]);
              } else {
                return Promise.reject({message: "That card is frozen! You must wait a turn to play it"});
              }

            } else {
              return Promise.reject({message: "You can only play a 2, or a 9 as targeted one-offs."});
            }
          } else {
            return Promise.reject({message: "You cannot play a card that is not in your hand"});
          }
        } else {
          return Promise.reject({message: "There is already a one-off in play; you cannot play any card, except a two to counter."});
        }
      } else {
        return Promise.reject({message: "It's not your turn."});
      }
    }) //End changeAndSave()
    .then(function populateGame(values) {
      return Promise.all([gameService.populateGame({gameId: values[0].id}), values[0]]);
    })
    .then(async function publishAndRespond(values) {
      const fullGame = values[0];
      const gameModel = values[1];
      const victory = await gameService.checkWinGame({
        game: fullGame,
        gameModel,
      });
      Game.publish([fullGame.id], {
        verb: 'updated',
        data: {
          change: 'targetedOneOff',
          game: fullGame,
          pNum: req.session.pNum,
          victory,
        },
      });
      return res.ok();
    }) //End publishAndRespond
    .catch(function failed(err) {
      return res.badRequest(err);
    });
}