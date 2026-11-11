import { mount } from "@vue/test-utils";
import { expect, test } from "vitest";
import SessionSyncStatus from "./SessionSyncStatus.vue";

test("pending and saved distinguish local persistence from server acknowledgement", async () => {
  const wrapper = mount(SessionSyncStatus, { props: { status: "pending" } });
  expect(wrapper.get("summary").text()).toBe("已存本机");
  expect(wrapper.text()).toContain("正在同步");
  expect(wrapper.find("[data-action='retry-sync']").exists()).toBe(false);
  await wrapper.setProps({ status: "saved" });
  expect(wrapper.get("summary").text()).toBe("已同步");
  expect(wrapper.text()).toContain("云端确认");
  wrapper.unmount();
});

test.each(["error", "conflict"] as const)("%s retains explicit retry and discard actions", async (status) => {
  const wrapper = mount(SessionSyncStatus, { props: { status } });
  if (status === "conflict") expect(wrapper.get("details").attributes("open")).toBeDefined();
  await wrapper.get("[data-action='retry-sync']").trigger("click");
  expect(wrapper.emitted("retry")).toHaveLength(1);
  expect(wrapper.emitted("discard")).toBeUndefined();
  await wrapper.get("[data-action='discard-sync']").trigger("click");
  expect(wrapper.emitted("discard")).toHaveLength(1);
  wrapper.unmount();
});
