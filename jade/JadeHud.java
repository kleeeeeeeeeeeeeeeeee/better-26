package net.minecraft.client.gui;

import java.util.ArrayList;
import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.CocoaBlock;
import net.minecraft.world.level.block.CropBlock;
import net.minecraft.world.level.block.NetherWartBlock;
import net.minecraft.world.level.block.RedStoneWireBlock;
import net.minecraft.world.level.block.StemBlock;
import net.minecraft.world.level.block.SweetBerryBushBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.IntegerProperty;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.EntityHitResult;
import net.minecraft.world.phys.HitResult;

/**
 * A small "what am I looking at" tooltip at the top of the screen, in the style of the
 * Jade mod (https://github.com/Snownee/Jade).
 *
 * This is a re-implementation for this game, not the Jade mod itself: the layout, the
 * colours, the blue italic mod-name line, the heart rows and the crop "Growth Value" and
 * redstone "Power" lines follow Jade's behaviour as read from its source code.
 * Jade is licensed under CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/);
 * this file is a derivative work under the same terms, for non-commercial use only.
 * Original author: Snownee.
 *
 * Everything is worked out on the client from what the client already knows (the block
 * state or entity under the crosshair), so it needs nothing from the server.
 */
public final class JadeHud {
   private static final Identifier HEART_CONTAINER = Identifier.withDefaultNamespace("hud/heart/container");
   private static final Identifier HEART_FULL = Identifier.withDefaultNamespace("hud/heart/full");
   private static final Identifier HEART_HALF = Identifier.withDefaultNamespace("hud/heart/half");
   private static final Identifier HEART_ABSORBING_FULL = Identifier.withDefaultNamespace("hud/heart/absorbing_full");
   private static final Identifier HEART_ABSORBING_HALF = Identifier.withDefaultNamespace("hud/heart/absorbing_half");
   private static final Identifier ARMOR_FULL = Identifier.withDefaultNamespace("hud/armor_full");
   private static final Identifier ARMOR_HALF = Identifier.withDefaultNamespace("hud/armor_half");
   private static final Identifier ARMOR_EMPTY = Identifier.withDefaultNamespace("hud/armor_empty");

   // Same as the vanilla tooltip frame, which Jade's default look is based on.
   private static final int BACKGROUND = 0xF0100010;
   private static final int BORDER_TOP = 0x505000FF;
   private static final int BORDER_BOTTOM = 0x5028007F;
   private static final int WHITE = 0xFFFFFFFF;

   private static final int MAX_HEART_ICONS = 20;
   private static final int HEARTS_PER_LINE = 10;

   private JadeHud() {
   }

   private static final class Info {
      ItemStack icon = ItemStack.EMPTY;
      Component title;
      final List<Component> lines = new ArrayList<>();
      // Entity health, drawn as hearts when it is small enough.
      boolean hasHealth;
      float health;
      float maxHealth;
      float absorption;
      int armor;
   }

   public static void extractRenderState(final Minecraft minecraft, final GuiGraphicsExtractor graphics) {
      if (minecraft.level == null || minecraft.player == null || minecraft.gui.screen() != null) {
         return;
      }
      Info info = gather(minecraft);
      if (info == null || info.title == null) {
         return;
      }
      draw(minecraft, graphics, info);
   }

   private static Info gather(final Minecraft minecraft) {
      HitResult hit = minecraft.hitResult;
      if (hit == null) {
         return null;
      }
      Info info = new Info();
      if (hit.getType() == HitResult.Type.BLOCK) {
         BlockPos pos = ((BlockHitResult)hit).getBlockPos();
         Level level = minecraft.level;
         BlockState state = level.getBlockState(pos);
         if (state.isAir()) {
            return null;
         }
         Block block = state.getBlock();
         info.title = block.getName();
         info.icon = new ItemStack(block);
         addBlockLines(info, block, state);
         return info;
      }
      if (hit.getType() == HitResult.Type.ENTITY) {
         Entity entity = ((EntityHitResult)hit).getEntity();
         info.title = entity.getDisplayName();
         if (entity instanceof LivingEntity living) {
            info.hasHealth = true;
            info.health = living.getHealth();
            info.maxHealth = living.getMaxHealth();
            info.absorption = living.getAbsorptionAmount();
            info.armor = living.getArmorValue();
         }
         return info;
      }
      return null;
   }

   private static void addBlockLines(final Info info, final Block block, final BlockState state) {
      if (block instanceof CropBlock || block instanceof NetherWartBlock || block instanceof CocoaBlock
         || block instanceof SweetBerryBushBlock || block instanceof StemBlock) {
         IntegerProperty age = findInteger(state, "age");
         if (age != null) {
            List<Integer> values = age.getPossibleValues();
            int max = values.get(values.size() - 1);
            int now = state.getValue(age);
            if (max > 0) {
               int percent = Math.round(now * 100.0F / max);
               if (now >= max) {
                  info.lines.add(Component.literal("Growth Value: ").withStyle(ChatFormatting.WHITE)
                     .append(Component.literal("Fully Grown").withStyle(ChatFormatting.GREEN)));
               } else {
                  info.lines.add(Component.literal("Growth Value: " + percent + "%").withStyle(ChatFormatting.WHITE));
               }
            }
         }
      }
      if (block instanceof RedStoneWireBlock) {
         IntegerProperty power = findInteger(state, "power");
         if (power != null) {
            info.lines.add(Component.literal("Power: " + state.getValue(power)).withStyle(ChatFormatting.RED));
         }
      }
   }

   private static IntegerProperty findInteger(final BlockState state, final String name) {
      for (Property<?> property : state.getProperties()) {
         if (property instanceof IntegerProperty integer && property.getName().equals(name)) {
            return integer;
         }
      }
      return null;
   }

   private static String formatNumber(final float value) {
      if (value == Math.rint(value)) {
         return Integer.toString((int)value);
      }
      return Float.toString(Math.round(value * 10.0F) / 10.0F);
   }

   private static void draw(final Minecraft minecraft, final GuiGraphicsExtractor graphics, final Info info) {
      Font font = minecraft.font;
      Component modName = Component.literal("Minecraft").withStyle(ChatFormatting.BLUE, ChatFormatting.ITALIC);

      int iconBox = info.icon.isEmpty() ? 0 : 20;
      int textWidth = Math.max(font.width(info.title.getVisualOrderText()), font.width(modName.getVisualOrderText()));
      for (Component line : info.lines) {
         textWidth = Math.max(textWidth, font.width(line.getVisualOrderText()));
      }

      // Health row: hearts when the entity has few, otherwise "health/max".
      int heartIcons = 0;
      int heartLines = 0;
      String healthText = null;
      int rowWidth = 0;
      if (info.hasHealth && info.maxHealth > 0.0F) {
         int icons = (int)Math.ceil(info.maxHealth) + (int)Math.ceil(info.absorption);
         if (icons > MAX_HEART_ICONS) {
            healthText = formatNumber(info.health + info.absorption) + "/" + formatNumber(info.maxHealth);
            rowWidth = 10 + font.width(healthText);
         } else {
            heartIcons = (icons + 1) / 2;
            heartLines = (heartIcons + HEARTS_PER_LINE - 1) / HEARTS_PER_LINE;
            rowWidth = 8 * Math.min(heartIcons, HEARTS_PER_LINE) + 1;
         }
         textWidth = Math.max(textWidth, rowWidth);
      }
      int armorIcons = info.hasHealth && info.armor > 0 ? (info.armor + 1) / 2 : 0;
      armorIcons = Math.min(armorIcons, HEARTS_PER_LINE);
      if (armorIcons > 0) {
         textWidth = Math.max(textWidth, 8 * armorIcons + 1);
      }

      int textHeight = 9 + 1 + 9; // title + mod name
      textHeight += info.lines.size() * 10;
      if (healthText != null) {
         textHeight += 10;
      } else if (heartLines > 0) {
         textHeight += 4 + 4 * heartLines + 1;
      }
      if (armorIcons > 0) {
         textHeight += 10;
      }

      int padding = 5;
      int width = padding + iconBox + textWidth + padding;
      int height = padding + Math.max(textHeight, iconBox == 0 ? 0 : 16) + padding;
      int x = (graphics.guiWidth() - width) / 2;
      int y = 6;

      graphics.nextStratum();
      graphics.fill(x + 1, y, x + width - 1, y + height, BACKGROUND);
      graphics.fill(x, y + 1, x + 1, y + height - 1, BACKGROUND);
      graphics.fill(x + width - 1, y + 1, x + width, y + height - 1, BACKGROUND);
      graphics.fillGradient(x + 1, y + 1, x + 2, y + height - 1, BORDER_TOP, BORDER_BOTTOM);
      graphics.fillGradient(x + width - 2, y + 1, x + width - 1, y + height - 1, BORDER_TOP, BORDER_BOTTOM);
      graphics.fill(x + 2, y + 1, x + width - 2, y + 2, BORDER_TOP);
      graphics.fill(x + 2, y + height - 2, x + width - 2, y + height - 1, BORDER_BOTTOM);

      if (!info.icon.isEmpty()) {
         graphics.item(info.icon, x + padding, y + padding + Math.max(0, (textHeight - 16) / 2));
      }
      int tx = x + padding + iconBox;
      int ty = y + padding;
      graphics.text(font, info.title.getVisualOrderText(), tx, ty, WHITE, true);
      ty += 10;
      for (Component line : info.lines) {
         graphics.text(font, line.getVisualOrderText(), tx, ty, WHITE, true);
         ty += 10;
      }

      if (healthText != null) {
         graphics.blitSprite(RenderPipelines.GUI_TEXTURED, HEART_FULL, tx, ty, 9, 9);
         graphics.text(font, healthText, tx + 10, ty + 1, WHITE, true);
         ty += 10;
      } else if (heartLines > 0) {
         drawHearts(graphics, info, tx, ty, heartIcons);
         ty += 4 + 4 * heartLines + 1;
      }
      if (armorIcons > 0) {
         for (int i = 0; i < armorIcons; i++) {
            int value = i * 2;
            Identifier sprite = info.armor >= value + 2 ? ARMOR_FULL : info.armor == value + 1 ? ARMOR_HALF : ARMOR_EMPTY;
            graphics.blitSprite(RenderPipelines.GUI_TEXTURED, sprite, tx + i * 8, ty, 9, 9);
         }
         ty += 10;
      }

      // The mod name goes last, as in Jade.
      graphics.text(font, modName.getVisualOrderText(), tx, y + height - padding - 9, WHITE, true);
   }

   private static void drawHearts(final GuiGraphicsExtractor graphics, final Info info, final int x, final int y, final int icons) {
      int maxHearts = (int)Math.ceil(info.maxHealth * 0.5F);
      float hearts = Math.round(info.health) * 0.5F;
      float absorbHearts = (float)Math.ceil(info.maxHealth) * 0.5F + info.absorption * 0.5F;
      for (int i = 0; i < icons; i++) {
         // Fill rows from the left, starting at the top row, like the vanilla health bar read in order.
         int col = i % HEARTS_PER_LINE;
         int row = i / HEARTS_PER_LINE;
         int hx = x + col * 8;
         int hy = y + row * 4;
         graphics.blitSprite(RenderPipelines.GUI_TEXTURED, HEART_CONTAINER, hx, hy, 9, 9);
         int index = i + 1;
         boolean absorb = index > maxHearts;
         float shown = absorb ? absorbHearts : hearts;
         Identifier full = absorb ? HEART_ABSORBING_FULL : HEART_FULL;
         Identifier half = absorb ? HEART_ABSORBING_HALF : HEART_HALF;
         if (index <= (int)Math.floor(shown)) {
            graphics.blitSprite(RenderPipelines.GUI_TEXTURED, full, hx, hy, 9, 9);
         } else if (index - 0.5F <= shown) {
            graphics.blitSprite(RenderPipelines.GUI_TEXTURED, half, hx, hy, 9, 9);
         }
      }
   }
}
