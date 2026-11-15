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
import net.minecraft.world.entity.decoration.ItemFrame;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.BeehiveBlock;
import net.minecraft.world.level.block.CocoaBlock;
import net.minecraft.world.level.block.CropBlock;
import net.minecraft.world.level.block.NetherWartBlock;
import net.minecraft.world.level.block.NoteBlock;
import net.minecraft.world.level.block.RedStoneWireBlock;
import net.minecraft.world.level.block.RepeaterBlock;
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
 * colours, the blue italic mod-name line, the heart rows, the item grids, the furnace
 * progress arrow and the crop "Growth Value" and redstone "Power" lines follow Jade's
 * behaviour as read from its source code.
 * Jade is licensed under CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/);
 * this file is a derivative work under the same terms, for non-commercial use only.
 * Original author: Snownee.
 *
 * What the client already knows (block state, entity) is read directly. What only the server
 * knows (container contents, furnace progress, brewing, jukebox) is requested through
 * {@link JadeLiteClient}; a server that does not answer simply leaves those lines out.
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
   private static final int GRAY = 0xFFAAAAAA;

   private static final int MAX_HEART_ICONS = 20;
   private static final int HEARTS_PER_LINE = 10;
   private static final int SLOT = 18;
   private static final int ITEMS_PER_ROW = 9;
   private static final int MAX_ITEM_ROWS = 3;

   /** Master switch for the tooltip. */
   public static boolean enabled = true;

   private JadeHud() {
   }

   // ---- Rows ----

   private abstract static class Row {
      abstract int width(Font font);

      abstract int height();

      abstract void draw(GuiGraphicsExtractor graphics, Font font, int x, int y);
   }

   private static final class TextRow extends Row {
      private final Component text;
      private final int color;

      TextRow(final Component text, final int color) {
         this.text = text;
         this.color = color;
      }

      @Override
      int width(final Font font) {
         return font.width(this.text.getVisualOrderText());
      }

      @Override
      int height() {
         return 10;
      }

      @Override
      void draw(final GuiGraphicsExtractor graphics, final Font font, final int x, final int y) {
         graphics.text(font, this.text.getVisualOrderText(), x, y, this.color, true);
      }
   }

   private static void drawStack(final GuiGraphicsExtractor graphics, final Font font, final ItemStack stack, final int x, final int y) {
      if (stack.isEmpty()) {
         return;
      }
      graphics.item(stack, x + 1, y + 1);
      graphics.itemDecorations(font, stack, x + 1, y + 1, stack.getCount() >= 1000 ? compact(stack.getCount()) : null);
   }

   private static String compact(final int count) {
      int tenths = count / 100;
      return (tenths / 10) + "." + (tenths % 10) + "k";
   }

   /** A grid of item icons, nine to a line. */
   private static final class ItemsRow extends Row {
      private final List<ItemStack> items;

      ItemsRow(final List<ItemStack> items) {
         this.items = items;
      }

      @Override
      int width(final Font font) {
         return Math.min(this.items.size(), ITEMS_PER_ROW) * SLOT;
      }

      @Override
      int height() {
         return ((this.items.size() + ITEMS_PER_ROW - 1) / ITEMS_PER_ROW) * SLOT;
      }

      @Override
      void draw(final GuiGraphicsExtractor graphics, final Font font, final int x, final int y) {
         for (int i = 0; i < this.items.size(); i++) {
            drawStack(graphics, font, this.items.get(i), x + (i % ITEMS_PER_ROW) * SLOT, y + (i / ITEMS_PER_ROW) * SLOT);
         }
      }
   }

   /** Furnace: input, fuel, a progress arrow, output. Brewing: ingredient, fuel, arrow, three bottles. */
   private static final class ProgressRow extends Row {
      private final List<ItemStack> before;
      private final List<ItemStack> after;
      private final float progress;

      ProgressRow(final List<ItemStack> before, final float progress, final List<ItemStack> after) {
         this.before = before;
         this.progress = Math.max(0.0F, Math.min(1.0F, progress));
         this.after = after;
      }

      @Override
      int width(final Font font) {
         return (this.before.size() + this.after.size()) * SLOT + 22 + 12;
      }

      @Override
      int height() {
         return SLOT;
      }

      @Override
      void draw(final GuiGraphicsExtractor graphics, final Font font, final int x, final int y) {
         int cursor = x;
         for (ItemStack stack : this.before) {
            drawStack(graphics, font, stack, cursor, y);
            cursor += SLOT;
         }
         cursor += 6;
         graphics.fill(cursor, y + 7, cursor + 22, y + 11, 0xFF555555);
         graphics.fill(cursor, y + 7, cursor + Math.round(22 * this.progress), y + 11, WHITE);
         cursor += 22 + 6;
         for (ItemStack stack : this.after) {
            drawStack(graphics, font, stack, cursor, y);
            cursor += SLOT;
         }
      }
   }

   /** Entity health: hearts when there are few, otherwise "health/max". */
   private static final class HealthRow extends Row {
      private final float health;
      private final float maxHealth;
      private final float absorption;
      private final int icons;

      HealthRow(final float health, final float maxHealth, final float absorption) {
         this.health = health;
         this.maxHealth = maxHealth;
         this.absorption = absorption;
         this.icons = (int)Math.ceil(maxHealth) + (int)Math.ceil(absorption);
      }

      private boolean asText() {
         return this.icons > MAX_HEART_ICONS;
      }

      private String text() {
         return formatNumber(this.health + this.absorption) + "/" + formatNumber(this.maxHealth);
      }

      private int heartIcons() {
         return (this.icons + 1) / 2;
      }

      @Override
      int width(final Font font) {
         return this.asText() ? 10 + font.width(this.text()) : 8 * Math.min(this.heartIcons(), HEARTS_PER_LINE) + 1;
      }

      @Override
      int height() {
         return this.asText() ? 10 : 4 + 4 * ((this.heartIcons() + HEARTS_PER_LINE - 1) / HEARTS_PER_LINE) + 1;
      }

      @Override
      void draw(final GuiGraphicsExtractor graphics, final Font font, final int x, final int y) {
         if (this.asText()) {
            graphics.blitSprite(RenderPipelines.GUI_TEXTURED, HEART_FULL, x, y, 9, 9);
            graphics.text(font, this.text(), x + 10, y + 1, WHITE, true);
            return;
         }
         int maxHearts = (int)Math.ceil(this.maxHealth * 0.5F);
         float hearts = Math.round(this.health) * 0.5F;
         float absorbHearts = (float)Math.ceil(this.maxHealth) * 0.5F + this.absorption * 0.5F;
         int count = this.heartIcons();
         for (int i = 0; i < count; i++) {
            int hx = x + (i % HEARTS_PER_LINE) * 8;
            int hy = y + (i / HEARTS_PER_LINE) * 4;
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

   private static final class ArmorRow extends Row {
      private final int armor;
      private final int icons;

      ArmorRow(final int armor) {
         this.armor = armor;
         this.icons = Math.min((armor + 1) / 2, HEARTS_PER_LINE);
      }

      @Override
      int width(final Font font) {
         return 8 * this.icons + 1;
      }

      @Override
      int height() {
         return 10;
      }

      @Override
      void draw(final GuiGraphicsExtractor graphics, final Font font, final int x, final int y) {
         for (int i = 0; i < this.icons; i++) {
            int value = i * 2;
            Identifier sprite = this.armor >= value + 2 ? ARMOR_FULL : this.armor == value + 1 ? ARMOR_HALF : ARMOR_EMPTY;
            graphics.blitSprite(RenderPipelines.GUI_TEXTURED, sprite, x + i * 8, y, 9, 9);
         }
      }
   }

   private static final class Info {
      ItemStack icon = ItemStack.EMPTY;
      Component title;
      final List<Row> rows = new ArrayList<>();
   }

   // ---- Frame ----

   public static void extractRenderState(final Minecraft minecraft, final GuiGraphicsExtractor graphics) {
      if (!enabled || minecraft.level == null || minecraft.player == null || minecraft.gui.screen() != null) {
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
         JadeLiteClient.maybeRequest(minecraft, pos, state);
         JadeLiteClient.Reply reply = JadeLiteClient.replyFor(pos);
         if (reply != null) {
            addServerLines(info, reply);
         }
         return info;
      }
      if (hit.getType() == HitResult.Type.ENTITY) {
         Entity entity = ((EntityHitResult)hit).getEntity();
         info.title = entity.getDisplayName();
         if (entity instanceof LivingEntity living) {
            float maxHealth = living.getMaxHealth();
            if (maxHealth > 0.0F) {
               info.rows.add(new HealthRow(living.getHealth(), maxHealth, living.getAbsorptionAmount()));
            }
            if (living.getArmorValue() > 0) {
               info.rows.add(new ArmorRow(living.getArmorValue()));
            }
         }
         if (entity instanceof ItemFrame frame && !frame.getItem().isEmpty()) {
            List<ItemStack> held = new ArrayList<>();
            held.add(frame.getItem());
            info.rows.add(new ItemsRow(held));
            info.rows.add(new TextRow(frame.getItem().getHoverName(), WHITE));
         }
         return info;
      }
      return null;
   }

   /** Lines that need only what the client already knows. */
   private static void addBlockLines(final Info info, final Block block, final BlockState state) {
      if (block instanceof CropBlock || block instanceof NetherWartBlock || block instanceof CocoaBlock
         || block instanceof SweetBerryBushBlock || block instanceof StemBlock) {
         IntegerProperty age = findInteger(state, "age");
         if (age != null) {
            List<Integer> values = age.getPossibleValues();
            int max = values.get(values.size() - 1);
            int now = state.getValue(age);
            if (max > 0) {
               if (now >= max) {
                  info.rows.add(new TextRow(Component.literal("Growth Value: ").withStyle(ChatFormatting.WHITE)
                     .append(Component.literal("Fully Grown").withStyle(ChatFormatting.GREEN)), WHITE));
               } else {
                  info.rows.add(new TextRow(Component.literal("Growth Value: " + Math.round(now * 100.0F / max) + "%"), WHITE));
               }
            }
         }
      }
      if (block instanceof RedStoneWireBlock) {
         IntegerProperty power = findInteger(state, "power");
         if (power != null) {
            info.rows.add(new TextRow(Component.literal("Power: " + state.getValue(power)).withStyle(ChatFormatting.RED), WHITE));
         }
      }
      if (block instanceof RepeaterBlock) {
         info.rows.add(new TextRow(Component.literal("Delay: " + state.getValue(RepeaterBlock.DELAY)), WHITE));
      }
      if (block instanceof NoteBlock) {
         info.rows.add(new TextRow(Component.literal("Note: " + state.getValue(NoteBlock.NOTE)), WHITE));
      }
      if (block instanceof BeehiveBlock) {
         info.rows.add(new TextRow(Component.literal("Honey Level: " + state.getValue(BeehiveBlock.HONEY_LEVEL)
            + "/" + BeehiveBlock.MAX_HONEY_LEVELS), WHITE));
      }
   }

   /** Lines built from the server's answer. */
   private static void addServerLines(final Info info, final JadeLiteClient.Reply reply) {
      if (reply.loot) {
         info.rows.add(new TextRow(Component.literal("Contents unknown"), GRAY));
      }
      if (reply.items != null) {
         if (reply.items.isEmpty()) {
            info.rows.add(new TextRow(Component.literal("Empty"), GRAY));
         } else {
            int cap = ITEMS_PER_ROW * MAX_ITEM_ROWS;
            List<ItemStack> shown = reply.items.size() > cap ? reply.items.subList(0, cap) : reply.items;
            info.rows.add(new ItemsRow(shown));
            if (reply.items.size() > cap) {
               info.rows.add(new TextRow(Component.literal("... and " + (reply.items.size() - cap) + " more"), GRAY));
            }
         }
      }
      if (reply.furnace && reply.furnaceItems != null && !allEmpty(reply.furnaceItems)) {
         List<ItemStack> before = new ArrayList<>();
         before.add(reply.furnaceItems[0]);
         before.add(reply.furnaceItems[1]);
         List<ItemStack> after = new ArrayList<>();
         after.add(reply.furnaceItems[2]);
         float progress = reply.cookTotal == 0 ? 0.0F : (float)reply.cookTime / reply.cookTotal;
         info.rows.add(new ProgressRow(before, progress, after));
      }
      if (reply.brewing && reply.brewItems != null && !allEmpty(reply.brewItems)) {
         List<ItemStack> before = new ArrayList<>();
         before.add(reply.brewItems[3]);
         before.add(reply.brewItems[4]);
         List<ItemStack> after = new ArrayList<>();
         after.add(reply.brewItems[0]);
         after.add(reply.brewItems[1]);
         after.add(reply.brewItems[2]);
         float progress = reply.brewTime > 0 ? 1.0F - reply.brewTime / 400.0F : 0.0F;
         info.rows.add(new ProgressRow(before, progress, after));
      }
      if (reply.jukebox && !reply.record.isEmpty()) {
         info.rows.add(new TextRow(Component.literal("Now playing: ").append(reply.record.getHoverName()), WHITE));
      }
   }

   private static boolean allEmpty(final ItemStack[] stacks) {
      for (ItemStack stack : stacks) {
         if (stack != null && !stack.isEmpty()) {
            return false;
         }
      }
      return true;
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
      int textHeight = 10 + 9; // title line + mod name line
      for (Row row : info.rows) {
         textWidth = Math.max(textWidth, row.width(font));
         textHeight += row.height();
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
      for (Row row : info.rows) {
         row.draw(graphics, font, tx, ty);
         ty += row.height();
      }

      // The mod name goes last, as in Jade.
      graphics.text(font, modName.getVisualOrderText(), tx, y + height - padding - 9, WHITE, true);
   }
}
