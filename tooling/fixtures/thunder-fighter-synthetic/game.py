"""Synthetic learner artifact for the eight-lesson live acceptance run."""
import random
import pygame

WIDTH, HEIGHT = 480, 640


class Game:
    def __init__(self, level=3):
        self.level = level
        self.running = True
        self.keys = set()
        self.rng = random.Random(27)
        self.reset()

    def reset(self):
        self.x, self.y = WIDTH / 2 - 18, HEIGHT - 80.0
        self.bullets, self.enemies = [], []
        self.score, self.lives, self.elapsed = 0, 3, 0.0
        self.spawn_timer, self.shot_timer = 0.4, 0.0
        self.game_over = False
        self.keys.clear()

    def handle(self, event):
        if event.type == pygame.QUIT:
            self.running = False
        elif event.type == pygame.KEYDOWN:
            if event.key == pygame.K_ESCAPE:
                self.running = False
            if event.key == pygame.K_r and self.game_over:
                self.reset()
            self.keys.add(event.key)
        elif event.type == pygame.KEYUP:
            self.keys.discard(event.key)
        elif event.type == pygame.WINDOWFOCUSLOST:
            self.keys.clear()

    @property
    def player(self):
        return pygame.Rect(round(self.x), round(self.y), 36, 42)

    def update(self, dt):
        dt = min(max(dt, 0), 0.05)
        if self.game_over:
            return
        self.elapsed += dt
        dx = int(bool(self.keys & {pygame.K_RIGHT, pygame.K_d})) - int(bool(self.keys & {pygame.K_LEFT, pygame.K_a}))
        dy = int(bool(self.keys & {pygame.K_DOWN, pygame.K_s})) - int(bool(self.keys & {pygame.K_UP, pygame.K_w}))
        self.x = max(0, min(WIDTH - 36, self.x + dx * 260 * dt))
        self.y = max(50, min(HEIGHT - 42, self.y + dy * 260 * dt))
        if self.level < 2:
            return
        self.shot_timer -= dt
        self.spawn_timer -= dt
        if pygame.K_SPACE in self.keys and self.shot_timer <= 0:
            self.bullets.append([self.x + 15, self.y - 14])
            self.shot_timer = 0.17
        if self.spawn_timer <= 0:
            self.enemies.append([float(self.rng.randint(20, WIDTH - 54)), -34.0])
            self.spawn_timer = 0.65
        for bullet in self.bullets:
            bullet[1] -= 480 * dt
        for enemy in self.enemies:
            enemy[1] += 135 * dt
        self.bullets = [bullet for bullet in self.bullets if bullet[1] > -16]
        remaining = []
        for enemy in self.enemies:
            rect = pygame.Rect(round(enemy[0]), round(enemy[1]), 34, 32)
            hit = next((bullet for bullet in self.bullets if rect.colliderect(pygame.Rect(round(bullet[0]), round(bullet[1]), 6, 14))), None)
            if hit is not None:
                self.bullets.remove(hit)
                if self.level >= 3:
                    self.score += 10
                continue
            if enemy[1] > HEIGHT or rect.colliderect(self.player):
                if self.level >= 3:
                    self.lives -= 1
                    if self.lives <= 0:
                        self.lives = 0
                        self.game_over = True
                continue
            remaining.append(enemy)
        self.enemies = remaining

    def draw(self, screen, font):
        screen.fill('#070e20')
        for i in range(65):
            pygame.draw.circle(screen, '#6d83a7', ((i * 113) % WIDTH, int((i * 73 + self.elapsed * 65) % HEIGHT)), 1)
        p = self.player
        pygame.draw.polygon(screen, '#4fe4f0', [(p.centerx, p.top), (p.left, p.bottom), (p.centerx, p.bottom - 10), (p.right, p.bottom)])
        pygame.draw.polygon(screen, '#ffb957', [(p.centerx - 6, p.bottom - 5), (p.centerx, p.bottom + 12), (p.centerx + 6, p.bottom - 5)])
        for x, y in self.bullets:
            pygame.draw.rect(screen, '#fff0a8', (int(x), int(y), 6, 14), border_radius=3)
        for x, y in self.enemies:
            pygame.draw.polygon(screen, '#fa687f', [(int(x), int(y)), (int(x + 34), int(y)), (int(x + 17), int(y + 32))])
        screen.blit(font.render(f'THUNDER   SCORE {self.score:04d}   LIFE {self.lives}', True, '#eff6ff'), (18, 16))
        screen.blit(font.render('Arrows / WASD   SPACE fire   ESC exit', True, '#9aaecb'), (18, HEIGHT - 26))
        if self.game_over:
            panel = pygame.Surface((WIDTH, 150), pygame.SRCALPHA)
            panel.fill((5, 10, 25, 230))
            screen.blit(panel, (0, HEIGHT // 2 - 65))
            screen.blit(font.render('GAME OVER   Press R to restart', True, '#ffffff'), (65, HEIGHT // 2))
        pygame.display.flip()


def main(level=3):
    pygame.init()
    screen = pygame.display.set_mode((WIDTH, HEIGHT))
    pygame.display.set_caption('Thunder Fighter - synthetic learner artifact')
    font, clock = pygame.font.Font(None, 24), pygame.time.Clock()
    game = Game(level)
    while game.running:
        dt = clock.tick(60) / 1000
        for event in pygame.event.get():
            game.handle(event)
        game.update(dt)
        game.draw(screen, font)
    pygame.quit()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--level', type=int, choices=[1, 2, 3], default=3)
    main(parser.parse_args().level)
