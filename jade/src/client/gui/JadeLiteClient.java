package net.minecraft.client.gui;

import io.netty.buffer.Unpooled;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.protocol.common.ServerboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.custom.JadeLiteDataPayload;
import net.minecraft.network.protocol.common.custom.JadeLiteRequestPayload;
import net.minecraft.resources.Identifier;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Client half of the Jade-style tooltip data: asks the server what is inside the block under
 * the crosshair and keeps the latest answer. A server that never answers (for example a plain
 * Paper server without the matching plugin) is only asked a few times per session.
 */
public final class JadeLiteClient {
   private static final long REFRESH_MS = 1000L;
   private static final long STALE_MS = 3500L;
   private static final int GIVE_UP_AFTER = 3;

   public static final class Reply {
      public long pos;
      public long receivedMs;
      /** Items inside a container, merged by type; null when the answer has no item list. */
      public List<ItemStack> items;
      public boolean loot;
      public boolean furnace;
      public int litTime;
      public int cookTime;
      public int cookTotal;
      public ItemStack[] furnaceItems;
      public boolean brewing;
      public int brewTime;
      public int fuel;
      public ItemStack[] brewItems;
      public boolean jukebox;
      public ItemStack record = ItemStack.EMPTY;
   }

   private static Reply reply;
   private static Object lastLevel;
   private static long requestedPos = Long.MIN_VALUE;
   private static long lastRequestMs;
   private static int unanswered;
   private static boolean everAnswered;

   private JadeLiteClient() {
   }

   /** Called every frame with the block under the crosshair; sends a request when one is due. */
   public static void maybeRequest(final Minecraft minecraft, final BlockPos pos, final BlockState state) {
      if (!state.hasBlockEntity()) {
         return;
      }
      if (minecraft.level != lastLevel) {
         lastLevel = minecraft.level;
         reply = null;
         requestedPos = Long.MIN_VALUE;
         unanswered = 0;
         everAnswered = false;
      }
      if (!everAnswered && unanswered >= GIVE_UP_AFTER) {
         return;
      }
      long now = System.currentTimeMillis();
      long key = pos.asLong();
      if (key == requestedPos && now - lastRequestMs < REFRESH_MS) {
         return;
      }
      ClientPacketListener connection = minecraft.getConnection();
      if (connection == null) {
         return;
      }
      requestedPos = key;
      lastRequestMs = now;
      if (!everAnswered) {
         unanswered++;
      }
      connection.send(new ServerboundCustomPayloadPacket(new JadeLiteRequestPayload(JadeLiteRequestPayload.BLOCK, key, 0)));
   }

   /** The latest answer for this block, or null when there is none or it is too old to trust. */
   public static Reply replyFor(final BlockPos pos) {
      Reply current = reply;
      if (current == null || current.pos != pos.asLong()) {
         return null;
      }
      return System.currentTimeMillis() - current.receivedMs > STALE_MS ? null : current;
   }

   public static void accept(final JadeLiteDataPayload payload) {
      if (payload.kind() != JadeLiteRequestPayload.BLOCK) {
         return;
      }
      everAnswered = true;
      Reply parsed = new Reply();
      parsed.pos = payload.pos();
      parsed.receivedMs = System.currentTimeMillis();
      FriendlyByteBuf in = new FriendlyByteBuf(Unpooled.wrappedBuffer(payload.body()));
      try {
         while (in.isReadable()) {
            int type = in.readUnsignedByte();
            switch (type) {
               case 1 -> {
                  int count = in.readVarInt();
                  List<ItemStack> list = new ArrayList<>();
                  for (int i = 0; i < count && i < 128; i++) {
                     ItemStack stack = stack(in.readUtf(), in.readVarInt());
                     if (!stack.isEmpty()) {
                        list.add(stack);
                     }
                  }
                  parsed.items = list;
               }
               case 2 -> {
                  parsed.furnace = true;
                  parsed.litTime = in.readVarInt();
                  parsed.cookTime = in.readVarInt();
                  parsed.cookTotal = in.readVarInt();
                  parsed.furnaceItems = readSlots(in, 3);
               }
               case 3 -> {
                  parsed.brewing = true;
                  parsed.brewTime = in.readVarInt();
                  parsed.fuel = in.readVarInt();
                  parsed.brewItems = readSlots(in, 5);
               }
               case 4 -> {
                  parsed.jukebox = true;
                  parsed.record = stack(in.readUtf(), 1);
               }
               case 5 -> parsed.loot = true;
               default -> {
                  // An unknown section: stop reading rather than misread what follows.
                  in.skipBytes(in.readableBytes());
               }
            }
         }
      } catch (RuntimeException e) {
         // A malformed answer is dropped; the tooltip simply shows nothing extra.
         return;
      }
      reply = parsed;
   }

   private static ItemStack[] readSlots(final FriendlyByteBuf in, final int count) {
      ItemStack[] slots = new ItemStack[count];
      for (int i = 0; i < count; i++) {
         slots[i] = stack(in.readUtf(), in.readVarInt());
      }
      return slots;
   }

   private static ItemStack stack(final String id, final int count) {
      if (id.isEmpty() || count <= 0) {
         return ItemStack.EMPTY;
      }
      try {
         Item item = BuiltInRegistries.ITEM.getValue(Identifier.parse(id));
         if (item == null) {
            return ItemStack.EMPTY;
         }
         ItemStack stack = new ItemStack(item, Math.min(count, 99999));
         return stack.isEmpty() ? ItemStack.EMPTY : stack;
      } catch (RuntimeException e) {
         return ItemStack.EMPTY;
      }
   }
}
