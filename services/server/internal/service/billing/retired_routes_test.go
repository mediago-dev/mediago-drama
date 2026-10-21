package billing

import (
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

func TestRetiredRouteUsageKeepsItsCapabilityGroup(t *testing.T) {
	caps := capabilityLookup{labels: map[string]string{"image.generate": "图像生成", "video.generate": "视频生成"}}
	for _, provider := range []string{"dmx", "mediago", "xiaoyunque"} {
		row := repository.UsageBucketRow{RouteID: provider + ".retired-model", Kind: "image"}
		id, label := groupForRow("capability", row, caps)
		if id != "image.generate" || label != "图像生成" {
			t.Fatalf("retired %s usage grouped as %q %q", provider, id, label)
		}
	}
	row := repository.UsageBucketRow{Kind: "image", CapabilityID: "video.generate"}
	if id, _ := groupForRow("capability", row, caps); id != "video.generate" {
		t.Fatalf("stored capability was overridden: %q", id)
	}
}
