package net.minecraft.client.gui;

import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.world.entity.player.Player;

/**
 * A small always-on coordinates readout: exact position, the block the player stands in
 * and the direction the player faces. Switched on and off, and moved between the four
 * corners, from the page's feature panel. Stays visible while chat or a menu is open;
 * hidden while the F3 debug screen is open, because that already shows the same numbers.
 */
public final class CoordsHud {
   private static final int MARGIN = 4;
   private static final int PAD = 3;
   // Below the page's performance pill, which sits in the top left corner.
   private static final int TOP_LEFT_Y = 28;

   private CoordsHud() {
   }

   public static void extractRenderState(final Minecraft minecraft, final GuiGraphicsExtractor graphics) {
      Player player = minecraft.player;
      // Stays on while chat or the pause menu is open, like the vanilla F3 numbers.
      if (player == null || minecraft.level == null
         || minecraft.debugEntries.isOverlayVisible() || !ClientFeatures.coords()) {
         return;
      }
      Font font = minecraft.font;

      MutableComponent position = Component.empty()
         .append(axis("X", ChatFormatting.RED, player.getX()))
         .append(axis("  Y", ChatFormatting.GREEN, player.getY()))
         .append(axis("  Z", ChatFormatting.AQUA, player.getZ()));
      Direction facing = player.getDirection();
      MutableComponent detail = Component.empty()
         .append(Component.literal("Block ").withStyle(ChatFormatting.GRAY))
         .append(Component.literal(player.getBlockX() + " " + player.getBlockY() + " " + player.getBlockZ())
            .withStyle(ChatFormatting.WHITE))
         .append(Component.literal("   " + name(facing)).withStyle(ChatFormatting.YELLOW));

      int width = Math.max(font.width(position.getVisualOrderText()), font.width(detail.getVisualOrderText())) + PAD * 2;
      int height = 9 * 2 + 1 + PAD * 2;

      String corner = ClientFeatures.coordsPos();
      boolean right = corner.charAt(1) == 'r';
      boolean bottom = corner.charAt(0) == 'b';
      int x = right ? graphics.guiWidth() - width - MARGIN : MARGIN;
      int y = bottom ? graphics.guiHeight() - height - MARGIN : (right ? MARGIN : TOP_LEFT_Y);

      graphics.nextStratum();
      graphics.fill(x, y, x + width, y + height, 0x88000000);
      graphics.text(font, position.getVisualOrderText(), x + PAD, y + PAD, 0xFFFFFFFF, true);
      graphics.text(font, detail.getVisualOrderText(), x + PAD, y + PAD + 10, 0xFFFFFFFF, true);
   }

   private static MutableComponent axis(final String label, final ChatFormatting color, final double value) {
      return Component.empty()
         .append(Component.literal(label + " ").withStyle(color))
         .append(Component.literal(format(value)).withStyle(ChatFormatting.WHITE));
   }

   /** One decimal place, written by hand so it does not depend on locale formatting. */
   private static String format(final double value) {
      long tenths = Math.round(value * 10.0);
      String digits = Long.toString(Math.abs(tenths));
      while (digits.length() < 2) {
         digits = "0" + digits;
      }
      return (tenths < 0 ? "-" : "") + digits.substring(0, digits.length() - 1) + "." + digits.substring(digits.length() - 1);
   }

   private static String name(final Direction direction) {
      String text = direction.getName();
      String label = text.substring(0, 1).toUpperCase() + text.substring(1);
      if (direction.getAxis().isVertical()) {
         return label;
      }
      return label + " (" + (direction.getAxisDirection() == Direction.AxisDirection.POSITIVE ? "+" : "-")
         + direction.getAxis().getName().toUpperCase() + ")";
   }
}
