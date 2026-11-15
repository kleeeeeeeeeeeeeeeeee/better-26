package net.minecraft.client.gui;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import org.teavm.jso.JSBody;

/**
 * Hands the page a small snapshot of the game every frame, in {@code globalThis.__eaglerGame},
 * so that overlays drawn by the page (the coordinates readout, the performance panel) can be
 * changed without rebuilding the game. Numbers go over every frame; the biome and dimension
 * names only when they change.
 *
 * Fields: inWorld, x, y, z, bx, by, bz (block), yaw, pitch, fps (the game's own count, the same
 * number it shows), guiScale, screen (0 none, 1 chat, 2 pause menu, 3 any other screen),
 * debug (F3 open), hudHidden (F1), time (day time in ticks), biome, dimension, t (performance.now()).
 */
final class GameStateBridge {
   private static String lastBiome = "";
   private static String lastDimension = "";
   private static int frame;

   private GameStateBridge() {
   }

   static void publish(final Minecraft minecraft) {
      Screen screen = minecraft.gui.screen();
      int screenCode = screen == null ? 0 : screen instanceof ChatScreen ? 1 : screen instanceof PauseScreen ? 2 : 3;
      LocalPlayer player = minecraft.player;
      boolean debug = minecraft.debugEntries.isOverlayVisible();
      boolean hudHidden = minecraft.gui.hud.isHidden();
      int guiScale = minecraft.getWindow().getGuiScale();
      if (player == null || minecraft.level == null) {
         publishMenu(minecraft.getFps(), guiScale, screenCode);
         lastBiome = "";
         lastDimension = "";
         return;
      }
      publishWorld(player.getX(), player.getY(), player.getZ(), player.getBlockX(), player.getBlockY(), player.getBlockZ(),
         player.getYRot(), player.getXRot(), minecraft.getFps(), guiScale, screenCode, debug, hudHidden,
         (double)minecraft.level.getDefaultClockTime());
      // Names change rarely; look them up a few times a second at most.
      if ((++frame & 7) == 0 || lastDimension.isEmpty()) {
         String dimension = minecraft.level.dimension().identifier().toString();
         String biome = minecraft.level.getBiome(BlockPos.containing(player.getX(), player.getY(), player.getZ()))
            .unwrapKey().map(key -> key.identifier().toString()).orElse("");
         if (!dimension.equals(lastDimension) || !biome.equals(lastBiome)) {
            lastDimension = dimension;
            lastBiome = biome;
            publishNames(dimension, biome);
         }
      }
   }

   @JSBody(params = { "x", "y", "z", "bx", "by", "bz", "yaw", "pitch", "fps", "guiScale", "screen", "debug", "hudHidden", "time" },
      script = "var g=globalThis.__eaglerGame||(globalThis.__eaglerGame={});"
         + "g.inWorld=true;g.x=x;g.y=y;g.z=z;g.bx=bx;g.by=by;g.bz=bz;g.yaw=yaw;g.pitch=pitch;g.fps=fps;"
         + "g.guiScale=guiScale;g.screen=screen;g.debug=debug;g.hudHidden=hudHidden;g.time=time;"
         + "g.t=performance.now();")
   private static native void publishWorld(double x, double y, double z, int bx, int by, int bz, float yaw, float pitch,
      int fps, int guiScale, int screen, boolean debug, boolean hudHidden, double time);

   @JSBody(params = { "fps", "guiScale", "screen" },
      script = "var g=globalThis.__eaglerGame||(globalThis.__eaglerGame={});"
         + "g.inWorld=false;g.fps=fps;g.guiScale=guiScale;g.screen=screen;g.biome='';g.dimension='';"
         + "g.t=performance.now();")
   private static native void publishMenu(int fps, int guiScale, int screen);

   @JSBody(params = { "dimension", "biome" },
      script = "var g=globalThis.__eaglerGame||(globalThis.__eaglerGame={});g.dimension=dimension;g.biome=biome;")
   private static native void publishNames(String dimension, String biome);
}
