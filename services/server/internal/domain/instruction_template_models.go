package domain

import "time"

// InstructionTemplateModel stores a user override for an official instruction template.
type InstructionTemplateModel struct {
	ID        string    `gorm:"column:id;primaryKey"`
	Content   string    `gorm:"column:content;not null;type:text"`
	CreatedAt time.Time `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null;autoUpdateTime:nano"`
}

// TableName returns the backing table name.
func (InstructionTemplateModel) TableName() string {
	return "instruction_templates"
}
