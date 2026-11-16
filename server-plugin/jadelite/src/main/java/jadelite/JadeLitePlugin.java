package jadelite;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockState;
import org.bukkit.block.BrewingStand;
import org.bukkit.block.Chest;
import org.bukkit.block.Container;
import org.bukkit.block.DoubleChest;
import org.bukkit.block.Furnace;
import org.bukkit.block.Jukebox;
import org.bukkit.block.Lockable;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.loot.Lootable;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.plugin.messaging.PluginMessageListener;

/**
 * Server half of the Jade-style tooltip in the better-26 Eaglercraft build, for a Paper server.
 *
 * The game asks on channel jadelite:req what is inside the block under the crosshair and this
 * plugin answers on jadelite:data, in the format documented in jade/README.md of the better-26
 * repository (the same format the game's own integrated server writes). Modelled on the server
 * data providers of the Jade mod (https://github.com/Snownee/Jade, CC BY-NC-SA 4.0).
 *
 * Rules, the same as the integrated server: only blocks within 12 blocks of the player in a
 * loaded chunk; locked containers are not read; containers that still have an unopened loot
 * table are reported as unknown instead of read, so looking at them never rolls their loot.
 */
public final class JadeLitePlugin extends JavaPlugin implements PluginMessageListener, Listener {
	static final String REQUEST = "jadelite:req";
	static final String DATA = "jadelite:data";

	private static final int T_ITEMS = 1;
	private static final int T_FURNACE = 2;
	private static final int T_BREWING = 3;
	private static final int T_JUKEBOX = 4;
	private static final int T_LOOT = 5;

	private static final double REACH = 12.0;
	private static final int MAX_ENTRIES = 54;
	private static final int MAX_BODY = 16384;
	private static final long MIN_INTERVAL_MS = 100L;

	private final Map<UUID, Long> lastRequest = new HashMap<>();
	private Method addChannel;
	private boolean warnedAddChannel;

	@Override
	public void onEnable() {
		getServer().getMessenger().registerIncomingPluginChannel(this, REQUEST, this);
		getServer().getMessenger().registerOutgoingPluginChannel(this, DATA);
		getServer().getPluginManager().registerEvents(this, this);
		for (Player player : getServer().getOnlinePlayers()) {
			allowChannel(player);
		}
		getLogger().info("Answering " + REQUEST + " on " + DATA);
	}

	@Override
	public void onDisable() {
		lastRequest.clear();
	}

	@EventHandler
	public void onJoin(PlayerJoinEvent event) {
		allowChannel(event.getPlayer());
	}

	@EventHandler
	public void onQuit(PlayerQuitEvent event) {
		lastRequest.remove(event.getPlayer().getUniqueId());
	}

	/**
	 * The server only sends plugin messages on channels the client has announced with
	 * minecraft:register (CraftPlayer.sendPluginMessage checks channels()). The Eaglercraft
	 * client does not announce, so add the channel on the server's side. On Paper 26.2 the
	 * register packet calls PluginMessageBridgeImpl.addChannel(String), a public default method
	 * that CraftPlayer inherits; it is not part of the plugin API, hence the reflection.
	 */
	private void allowChannel(Player player) {
		try {
			if (addChannel == null) {
				addChannel = player.getClass().getMethod("addChannel", String.class);
			}
			addChannel.invoke(player, DATA);
		} catch (ReflectiveOperationException | RuntimeException e) {
			if (!warnedAddChannel) {
				warnedAddChannel = true;
				getLogger().warning("Could not enable " + DATA + " for players (" + e + "); the tooltip will not get answers");
			}
		}
	}

	@Override
	public void onPluginMessageReceived(String channel, Player player, byte[] message) {
		if (!REQUEST.equals(channel)) {
			return;
		}
		long now = System.currentTimeMillis();
		Long last = lastRequest.get(player.getUniqueId());
		if (last != null && now - last < MIN_INTERVAL_MS) {
			return;
		}
		lastRequest.put(player.getUniqueId(), now);
		if (Bukkit.isPrimaryThread()) {
			answer(player, message);
		} else {
			Bukkit.getScheduler().runTask(this, () -> answer(player, message));
		}
	}

	private void answer(Player player, byte[] message) {
		if (!player.isOnline()) {
			return;
		}
		int kind;
		long packed;
		try (DataInputStream in = new DataInputStream(new ByteArrayInputStream(message))) {
			kind = in.readUnsignedByte();
			packed = in.readLong();
		} catch (IOException e) {
			return;
		}
		if (kind != 0) {
			return;
		}
		// BlockPos.asLong: x in the top 26 bits, z in the next 26, y in the low 12.
		int x = (int) (packed >> 38);
		int y = (int) (packed << 52 >> 52);
		int z = (int) (packed << 26 >> 38);

		World world = player.getWorld();
		if (!world.isChunkLoaded(x >> 4, z >> 4)) {
			return;
		}
		Location center = new Location(world, x + 0.5, y + 0.5, z + 0.5);
		if (player.getLocation().distanceSquared(center) > REACH * REACH) {
			return;
		}

		Body body = new Body();
		Block block = world.getBlockAt(x, y, z);
		BlockState state = block.getState(false);
		if (block.getType() == Material.ENDER_CHEST) {
			// An ender chest belongs to the player looking at it.
			body.items(collect(new LinkedHashMap<>(), player.getEnderChest()));
		} else if (state instanceof Chest chest) {
			writeChest(body, chest);
		} else if (state instanceof Furnace furnace) {
			if (readable(furnace)) {
				body.byte_(T_FURNACE);
				body.varInt(Math.max(0, furnace.getBurnTime()));
				body.varInt(Math.max(0, furnace.getCookTime()));
				body.varInt(Math.max(0, furnace.getCookTimeTotal()));
				Inventory inventory = furnace.getInventory();
				for (int slot = 0; slot < 3; slot++) {
					body.stack(inventory.getItem(slot));
				}
			}
		} else if (state instanceof BrewingStand brewing) {
			if (readable(brewing)) {
				body.byte_(T_BREWING);
				body.varInt(Math.max(0, brewing.getBrewingTime()));
				body.varInt(Math.max(0, brewing.getFuelLevel()));
				Inventory inventory = brewing.getInventory();
				for (int slot = 0; slot < 5; slot++) {
					body.stack(inventory.getItem(slot));
				}
			}
		} else if (state instanceof Jukebox jukebox) {
			body.byte_(T_JUKEBOX);
			ItemStack record = jukebox.getRecord();
			body.utf(empty(record) ? "" : id(record));
		} else if (state instanceof Container container) {
			// Barrels, shulker boxes, hoppers, droppers, dispensers and the like.
			if (readable(container)) {
				if (hasUnopenedLoot(container)) {
					body.byte_(T_LOOT);
				} else {
					body.items(collect(new LinkedHashMap<>(), container.getInventory()));
				}
			}
		}

		// An empty answer is still an answer: it tells the client this server understands.
		byte[] content = body.toByteArray();
		if (content.length > MAX_BODY) {
			return;
		}
		Body reply = new Body();
		reply.byte_(0);
		reply.long_(packed);
		reply.varInt(0);
		reply.varInt(content.length);
		reply.bytes(content);
		player.sendPluginMessage(this, DATA, reply.toByteArray());
	}

	private void writeChest(Body body, Chest chest) {
		List<Chest> halves = new ArrayList<>();
		InventoryHolder holder = chest.getInventory().getHolder();
		if (holder instanceof DoubleChest doubleChest) {
			if (doubleChest.getLeftSide() instanceof Chest left) {
				halves.add(left);
			}
			if (doubleChest.getRightSide() instanceof Chest right) {
				halves.add(right);
			}
		}
		if (halves.isEmpty()) {
			halves.add(chest);
		}
		Map<String, Integer> totals = new LinkedHashMap<>();
		boolean unknownLoot = false;
		for (Chest half : halves) {
			if (!readable(half)) {
				return;
			}
			if (hasUnopenedLoot(half)) {
				unknownLoot = true;
				continue;
			}
			collect(totals, half.getBlockInventory());
		}
		if (unknownLoot && totals.isEmpty()) {
			body.byte_(T_LOOT);
		} else {
			body.items(totals);
		}
	}

	private static boolean readable(BlockState state) {
		return !(state instanceof Lockable lockable && lockable.isLocked());
	}

	private static boolean hasUnopenedLoot(BlockState state) {
		return state instanceof Lootable lootable && lootable.hasLootTable();
	}

	private static Map<String, Integer> collect(Map<String, Integer> totals, Inventory inventory) {
		for (ItemStack stack : inventory.getContents()) {
			if (!empty(stack)) {
				totals.merge(id(stack), stack.getAmount(), Integer::sum);
			}
		}
		return totals;
	}

	private static boolean empty(ItemStack stack) {
		return stack == null || stack.getType().isAir() || stack.getAmount() <= 0;
	}

	private static String id(ItemStack stack) {
		return stack.getType().getKey().toString();
	}

	/** Writes the game's FriendlyByteBuf encoding: big-endian numbers, VarInts, VarInt-prefixed UTF-8. */
	private static final class Body {
		private final ByteArrayOutputStream out = new ByteArrayOutputStream();

		void byte_(int value) {
			out.write(value & 0xFF);
		}

		void long_(long value) {
			for (int shift = 56; shift >= 0; shift -= 8) {
				out.write((int) (value >>> shift) & 0xFF);
			}
		}

		void varInt(int value) {
			while ((value & ~0x7F) != 0) {
				out.write((value & 0x7F) | 0x80);
				value >>>= 7;
			}
			out.write(value);
		}

		void utf(String text) {
			byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
			varInt(bytes.length);
			out.write(bytes, 0, bytes.length);
		}

		void bytes(byte[] bytes) {
			out.write(bytes, 0, bytes.length);
		}

		void stack(ItemStack stack) {
			utf(empty(stack) ? "" : id(stack));
			varInt(empty(stack) ? 0 : stack.getAmount());
		}

		void items(Map<String, Integer> totals) {
			byte_(T_ITEMS);
			varInt(Math.min(totals.size(), MAX_ENTRIES));
			int written = 0;
			for (Map.Entry<String, Integer> entry : totals.entrySet()) {
				if (written++ >= MAX_ENTRIES) {
					break;
				}
				utf(entry.getKey());
				varInt(entry.getValue());
			}
		}

		byte[] toByteArray() {
			return out.toByteArray();
		}
	}
}
