"""Run actual Pygame rendering and event input; no product learning facts written."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
from datetime import datetime, timezone
import pygame
from game import Game, WIDTH, HEIGHT

parser = argparse.ArgumentParser()
parser.add_argument('--level', type=int, choices=[1, 2, 3], required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
pygame.init()
screen = pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption('Thunder Fighter acceptance - actual Pygame window')
font = pygame.font.Font(None, 24)
game = Game(args.level)
checks = []


def check(name, condition):
    if not condition:
        raise AssertionError(name)
    checks.append(name)


def key(code, down=True):
    pygame.event.post(pygame.event.Event(pygame.KEYDOWN if down else pygame.KEYUP, key=code))


def frames(count=1):
    for _ in range(count):
        for event in pygame.event.get():
            game.handle(event)
        game.update(1 / 60)
        game.draw(screen, font)
        pygame.time.Clock().tick(120)


start = game.x
key(pygame.K_RIGHT)
frames(30)
key(pygame.K_RIGHT, False)
frames()
check('actual event queue moves player right', game.x > start + 100)
buggy_x = 100
for _ in range(30):
    buggy_x = int(buggy_x + 260 / 60)
integer_regression = {'oldIntegerDistance': buggy_x - 100, 'expectedDistance': 130, 'actualFloatDistance': round(game.x - start, 6)}
check('floating position fixes reproduced integer truncation', buggy_x - 100 == 120 and abs(game.x - start - 130) < 0.0001)
stopped = game.x
frames(15)
check('key release stops movement', game.x == stopped)
key(pygame.K_LEFT)
frames(150)
key(pygame.K_LEFT, False)
frames()
check('left screen boundary clamps player', game.x == 0)
pygame.image.save(screen, args.output / f'lesson-{args.level + 3}-playing.png')
if args.level >= 2:
    key(pygame.K_SPACE)
    frames(20)
    key(pygame.K_SPACE, False)
    frames()
    check('space input produces moving bullets', len(game.bullets) > 0)
    check('timer produces descending enemies', len(game.enemies) > 0)
    game.bullets = [[100, -20]]
    game.enemies = [[100, HEIGHT + 1]]
    frames()
    check('offscreen objects are removed', not game.bullets and not game.enemies)
if args.level >= 3:
    game.reset()
    game.spawn_timer = 10
    game.enemies = [[game.x + 1, game.y - 100]]
    key(pygame.K_SPACE)
    frames(18)
    key(pygame.K_SPACE, False)
    frames()
    check('bullet hit increases score once', game.score == 10)
    frames(20)
    check('same hit cannot award score twice', game.score == 10)
    for _ in range(3):
        game.enemies = [[game.x, game.y]]
        frames()
    check('three collisions produce game over', game.game_over and game.lives == 0)
    pygame.image.save(screen, args.output / 'game-over.png')
    key(pygame.K_r)
    frames()
    check('R restarts score life and object state', not game.game_over and game.lives == 3 and game.score == 0 and not game.enemies and not game.bullets)
    pygame.image.save(screen, args.output / 'restarted.png')
pygame.event.post(pygame.event.Event(pygame.QUIT))
frames()
check('window quit ends loop', not game.running)
report = {'at': datetime.now(timezone.utc).isoformat(), 'level': args.level, 'python': platform.python_version(),
          'pygame': pygame.version.ver, 'videoDriver': pygame.display.get_driver(),
          'sourceSha256': hashlib.sha256(Path(__file__).with_name('game.py').read_bytes()).hexdigest(),
          'integerPositionRegression': integer_regression,
          'checks': checks, 'passed': True, 'scope': 'real Pygame window, synthetic event-queue input; not an automated production container runner'}
(args.output / f'level-{args.level}-result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
pygame.quit()
print(json.dumps(report))
