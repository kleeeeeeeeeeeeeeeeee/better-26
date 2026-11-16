package net.minecraft.network.protocol.common.custom;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.resources.Identifier;

/**
 * Server to client: the answer to a {@link JadeLiteRequestPayload}.
 * Wire format (channel jadelite:data): byte kind, long block position, varint entity id,
 * then a byte array holding a list of sections. Each section starts with a byte type:
 * <pre>
 *  1 ITEMS   varint n, n x (utf item id, varint count)   items inside a container
 *  2 FURNACE varint litTime, varint cookTime, varint cookTotal, 3 x (utf id or "", varint count)
 *  3 BREWING varint brewTime, varint fuel, 5 x (utf id or "", varint count)
 *  4 JUKEBOX utf record item id or ""
 *  5 LOOT    (no body) the container has an unopened loot table and is not listed
 * </pre>
 * Item ids are plain registry names such as "minecraft:diamond", so a server plugin can
 * produce this without touching the game's item encoding.
 */
public record JadeLiteDataPayload(int kind, long pos, int entityId, byte[] body) implements CustomPacketPayload {
   public static final int MAX_BODY = 16384;
   public static final Type<JadeLiteDataPayload> TYPE = new Type<>(Identifier.parse("jadelite:data"));
   public static final StreamCodec<FriendlyByteBuf, JadeLiteDataPayload> STREAM_CODEC = CustomPacketPayload.codec(
         (value, output) -> {
            output.writeByte(value.kind);
            output.writeLong(value.pos);
            output.writeVarInt(value.entityId);
            output.writeByteArray(value.body);
         },
         input -> new JadeLiteDataPayload(input.readUnsignedByte(), input.readLong(), input.readVarInt(),
               input.readByteArray(MAX_BODY))
   );

   @Override
   public Type<JadeLiteDataPayload> type() {
      return TYPE;
   }
}
