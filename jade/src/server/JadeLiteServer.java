package net.minecraft.server;

import io.netty.buffer.Unpooled;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.custom.JadeLiteDataPayload;
import net.minecraft.network.protocol.common.custom.JadeLiteRequestPayload;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.Container;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.ChestBlock;
import net.minecraft.world.level.block.EnderChestBlock;
import net.minecraft.world.level.block.entity.AbstractFurnaceBlockEntity;
import net.minecraft.world.level.block.entity.BaseContainerBlockEntity;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.BrewingStandBlockEntity;
import net.minecraft.world.level.block.entity.ChestBlockEntity;
import net.minecraft.world.level.block.entity.JukeboxBlockEntity;
import net.minecraft.world.level.block.entity.RandomizableContainerBlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.ChestType;
import net.minecraft.world.phys.Vec3;

/**
 * Server half of the Jade-style tooltip: answers {@link JadeLiteRequestPayload} with what is
 * inside the block the player is looking at (see {@link JadeLiteDataPayload} for the format).
 * Modelled on the server data providers of the Jade mod (https://github.com/Snownee/Jade,
 * CC BY-NC-SA 4.0), which read the same block entity fields.
 *
 * Containers that still hold an unopened loot table are never read, because reading their
 * slots would roll the loot. Locked containers are skipped for players who cannot open them.
 */
public final class JadeLiteServer {
   static final int T_ITEMS = 1;
   static final int T_FURNACE = 2;
   static final int T_BREWING = 3;
   static final int T_JUKEBOX = 4;
   static final int T_LOOT = 5;

   private static final double REACH = 12.0;
   private static final int MAX_ENTRIES = 54;

   private JadeLiteServer() {
   }

   public static void handle(final ServerPlayer player, final JadeLiteRequestPayload request) {
      if (request.kind() != JadeLiteRequestPayload.BLOCK) {
         return;
      }
      ServerLevel level = player.level();
      BlockPos pos = BlockPos.of(request.pos());
      if (!level.isLoaded(pos) || player.distanceToSqr(Vec3.atCenterOf(pos)) > REACH * REACH) {
         return;
      }
      BlockState state = level.getBlockState(pos);
      BlockEntity entity = level.getBlockEntity(pos);
      FriendlyByteBuf out = new FriendlyByteBuf(Unpooled.buffer());

      if (state.getBlock() instanceof EnderChestBlock) {
         // An ender chest belongs to the player looking at it.
         writeItems(out, player.getEnderChestInventory());
      } else if (entity instanceof ChestBlockEntity chest) {
         writeChest(out, player, level, pos, state, chest);
      } else if (entity instanceof AbstractFurnaceBlockEntity furnace) {
         if (canRead(player, furnace) && !hasUnopenedLoot(furnace)) {
            out.writeByte(T_FURNACE);
            out.writeVarInt(furnace.jadeLitTime());
            out.writeVarInt(furnace.jadeCookingTimer());
            out.writeVarInt(furnace.jadeCookingTotal());
            for (int slot = 0; slot < 3; slot++) {
               writeStack(out, furnace.getItem(slot));
            }
         }
      } else if (entity instanceof BrewingStandBlockEntity brewing) {
         if (canRead(player, brewing)) {
            out.writeByte(T_BREWING);
            out.writeVarInt(brewing.jadeBrewTime());
            out.writeVarInt(brewing.jadeFuel());
            for (int slot = 0; slot < 5; slot++) {
               writeStack(out, brewing.getItem(slot));
            }
         }
      } else if (entity instanceof JukeboxBlockEntity jukebox) {
         out.writeByte(T_JUKEBOX);
         ItemStack record = jukebox.getTheItem();
         out.writeUtf(record.isEmpty() ? "" : BuiltInRegistries.ITEM.getKey(record.getItem()).toString());
      } else if (entity instanceof BaseContainerBlockEntity container) {
         // Barrels, shulker boxes, hoppers, droppers, dispensers and the like.
         if (canRead(player, container)) {
            if (hasUnopenedLoot(container)) {
               out.writeByte(T_LOOT);
            } else {
               writeItems(out, container);
            }
         }
      }

      // An empty answer is still an answer: it tells the client this server understands the request.
      if (out.writerIndex() > JadeLiteDataPayload.MAX_BODY) {
         return;
      }
      byte[] body = new byte[out.writerIndex()];
      out.getBytes(0, body);
      player.connection.send(new ClientboundCustomPayloadPacket(new JadeLiteDataPayload(
            JadeLiteRequestPayload.BLOCK, request.pos(), 0, body)));
   }

   private static boolean canRead(final ServerPlayer player, final BaseContainerBlockEntity container) {
      return container.canOpen(player);
   }

   private static boolean hasUnopenedLoot(final BlockEntity entity) {
      return entity instanceof RandomizableContainerBlockEntity random && random.getLootTable() != null;
   }

   private static void writeChest(final FriendlyByteBuf out, final ServerPlayer player, final ServerLevel level,
         final BlockPos pos, final BlockState state, final ChestBlockEntity chest) {
      List<ChestBlockEntity> halves = new ArrayList<>();
      halves.add(chest);
      if (state.hasProperty(ChestBlock.TYPE) && state.getValue(ChestBlock.TYPE) != ChestType.SINGLE) {
         BlockEntity other = level.getBlockEntity(pos.relative(ChestBlock.getConnectedDirection(state)));
         if (other instanceof ChestBlockEntity otherChest) {
            halves.add(otherChest);
         }
      }
      Map<String, Integer> totals = new LinkedHashMap<>();
      boolean unknownLoot = false;
      for (ChestBlockEntity half : halves) {
         if (!canRead(player, half)) {
            return;
         }
         if (hasUnopenedLoot(half)) {
            unknownLoot = true;
            continue;
         }
         collect(totals, half);
      }
      if (unknownLoot && totals.isEmpty()) {
         out.writeByte(T_LOOT);
      } else {
         writeTotals(out, totals);
      }
   }

   private static void collect(final Map<String, Integer> totals, final Container container) {
      for (int slot = 0; slot < container.getContainerSize(); slot++) {
         ItemStack stack = container.getItem(slot);
         if (!stack.isEmpty()) {
            totals.merge(BuiltInRegistries.ITEM.getKey(stack.getItem()).toString(), stack.getCount(), Integer::sum);
         }
      }
   }

   private static void writeItems(final FriendlyByteBuf out, final Container container) {
      Map<String, Integer> totals = new LinkedHashMap<>();
      collect(totals, container);
      writeTotals(out, totals);
   }

   private static void writeTotals(final FriendlyByteBuf out, final Map<String, Integer> totals) {
      out.writeByte(T_ITEMS);
      out.writeVarInt(Math.min(totals.size(), MAX_ENTRIES));
      int written = 0;
      for (Map.Entry<String, Integer> entry : totals.entrySet()) {
         if (written++ >= MAX_ENTRIES) {
            break;
         }
         out.writeUtf(entry.getKey());
         out.writeVarInt(entry.getValue());
      }
   }

   private static void writeStack(final FriendlyByteBuf out, final ItemStack stack) {
      out.writeUtf(stack.isEmpty() ? "" : BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
      out.writeVarInt(stack.isEmpty() ? 0 : stack.getCount());
   }
}
